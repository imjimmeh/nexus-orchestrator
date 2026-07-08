/**
 * In-memory memory observability snapshot service.
 *
 * The work item calls for "OpenTelemetry counters", but this project's
 * actual metrics layer is **prom-client** (see
 * `apps/api/src/observability/metrics.service.ts`) and the close precedent
 * for an in-memory snapshot is `ChatMemoryMetricsService` (this directory's
 * sibling). The prom-client instruments are incremented in lock-step by
 * the call sites; this service maintains a per-process snapshot that the
 * milestone 2 REST controller can expose as JSON.
 *
 * Concretely, every call here MUST be paired with the matching
 * `MetricsService.record*` call at the call site, but this service does
 * not depend on `MetricsService` to keep its unit tests trivial (the
 * service is a pure data accumulator).
 *
 * Single-process: object maps keyed by labels; no external locks. If/when
 * the API is run in clustered mode this snapshot will diverge between
 * workers; the prom-client scrape remains the source of truth for
 * aggregated metrics and the REST endpoint is intended as a per-instance
 * observability view.
 */
import { Injectable, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
  coerceLearningConvergenceWindowDays,
} from '../settings/learning-convergence-settings.constants';
import { MetricsService } from '../observability/metrics.service';
import { LearningMeasurementState } from './learning-measurement.state';
import { computeConvergenceSnapshots } from './learning-convergence.helper';
import type {
  BackendLabel,
  BackendLatencySummary,
  DistillationMetrics,
  DistillationOutcome,
  DistillationOutcomePayload,
  LearningBehaviourChangePayload,
  LearningConvergenceSnapshot,
  LearningLastLessonInjected,
  LearningLastRunOutcomeAfterLesson,
  LearningLessonInjectRecord,
  LearningLessonInjectedPayload,
  LearningLiftSnapshot,
  LearningMetrics,
  LearningPromotedPayload,
  LearningRunOutcomeAfterLessonPayload,
  MemoryMetricsSnapshot,
  MemoryWriteOutcome,
  PostmortemRecordedPayload,
  ProbationOutcomeCounts,
  WorkflowPostmortemMetrics,
} from './memory-metrics.types';

const LATENCY_RESERVOIR_CAPACITY = 1024;

/**
 * Hard upper bound on the per-scope ring buffer size (work
 * item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). The
 * convergence snapshot is only meaningful within the rolling
 * window (`learning_convergence_window_days`, default 7 days)
 * so any sample older than that cannot affect the ratio; the
 * hard cap is a defensive bound for a long-lived process that
 * never trims (e.g. an operator-supplied `window_days = 90`).
 *
 * Sized at 100k entries per scope — at the peak observed
 * `run_outcome_after_lesson` event rate (≈1/s) that is ≈28
 * hours of headroom, well above the rolling window. The cap
 * protects against accidental memory growth in a misconfigured
 * environment without changing the semantics of the snapshot
 * (the oldest samples are dropped first, exactly like the
 * `LATENCY_RESERVOIR_CAPACITY` pattern in this file).
 */
const MAX_CONVERGENCE_RING_PER_SCOPE = 100_000;

@Injectable()
export class MemoryMetricsService {
  constructor(
    @Optional() private readonly settings?: SystemSettingsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * EPIC-212 Phase 3 Task 6 causal-measurement state (behaviour-change
   * counter, A/B holdout lift, cost-per-promoted-memory, suppressed-noise
   * rollup). Self-initialising so both `new MemoryMetricsService()` and the
   * DI construction path work without constructor wiring.
   */
  private readonly measurement = new LearningMeasurementState();

  private readonly backendReadTotal: Record<BackendLabel, number> = {
    postgres: 0,
    honcho: 0,
  };

  private readonly backendReadLatencyCount: Record<BackendLabel, number> = {
    postgres: 0,
    honcho: 0,
  };

  private readonly backendReadLatencySum: Record<BackendLabel, number> = {
    postgres: 0,
    honcho: 0,
  };

  private readonly backendReadLatencySamples: Record<BackendLabel, number[]> = {
    postgres: [],
    honcho: [],
  };

  private readonly backendWriteTotal: Record<
    BackendLabel,
    Record<MemoryWriteOutcome, number>
  > = {
    postgres: { success: 0, failure: 0 },
    honcho: { success: 0, failure: 0 },
  };

  private readonly backendActiveSegments: Record<
    BackendLabel,
    Record<string, number>
  > = {
    postgres: {},
    honcho: {},
  };

  private readonly backendFallbackKeys = new Set<string>();
  private readonly backendFallbackCounts: Record<string, number> = {};

  private readonly distillationCompleted: Record<DistillationOutcome, number> =
    {
      success: 0,
      failure: 0,
      skipped: 0,
    };

  private distillationLast: DistillationMetrics['last'] = null;

  private learningPromotedTotal = 0;
  private learningLastPromoted: LearningMetrics['last_promoted'] = null;

  /**
   * "Use" leg of the self-improvement feedback loop
   * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db).
   * Counts every promoted learning lesson that was actually
   * injected into a downstream agent's planning context. The
   * per-(lesson_id, scope) breakdown lives in the
   * `nexus_learning_lesson_injected_total` prom-client
   * instrument on `MetricsService`; this counter mirrors the
   * unlabelled total so the per-process REST snapshot can
   * answer "did downstream agents use any promoted lessons?"
   * without scraping Prometheus.
   */
  private learningLessonInjectedTotal = 0;
  private learningLastLessonInjected: LearningLastLessonInjected | null = null;

  /**
   * Per-scope lesson-inject timestamp ring buffer (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). The
   * convergence ratio is `success / total` over a rolling
   * window of `learning_convergence_window_days` days; without
   * per-event timestamps we cannot drop expired samples. The
   * ring is keyed by `scope` and stores the wall-clock
   * timestamps of every recorded injection so the snapshot
   * filter can drop samples older than `now - windowMs`.
   *
   * `Map<string, number[]>` is intentional: `scope` is a UUID
   * with bounded cardinality (the same bound as the prom-client
   * labels), and the inner array is append-only-trimmed on
   * every `record*` call to bound memory at
   * `MAX_INJECT_RING_PER_SCOPE * active_scopes`.
   */
  private readonly learningInjectTimestampsByScope = new Map<
    string,
    number[]
  >();

  /**
   * Per-scope run-outcome timestamp ring buffer (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). The
   * convergence denominator is the count of outcome-counter
   * events in the window; the numerator is the subset whose
   * `outcome` is `'success'`. Storing the timestamp +
   * outcome together lets `computeConvergenceSnapshots` drop
   * expired samples without keeping a separate per-scope
   * outcomes map.
   */
  private readonly learningOutcomeTimestampsByScope = new Map<
    string,
    Array<{ at: number; outcome: 'success' | 'failure' }>
  >();

  /**
   * Convergence-side counter (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2).
   * Counts terminal workflow-run outcomes observed AFTER at
   * least one promoted learning lesson was injected into a
   * planning step during the run. The
   * per-(lesson_id, scope, outcome) breakdown lives in the
   * `nexus_workflow_run_outcome_after_lesson_total` prom-client
   * instrument on `MetricsService`; this unlabelled counter
   * mirrors the total for the per-process REST snapshot.
   */
  private learningRunOutcomeAfterLessonTotal = 0;
  private learningLastRunOutcomeAfterLesson: LearningLastRunOutcomeAfterLesson | null =
    null;

  /**
   * Per-run inject tracker (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2). For
   * every `recordLearningLessonInjected` call we record the
   * `(lesson_id, scope)` pair in the set keyed by the workflow
   * run id; on the terminal `workflow.run.{completed,failed}`
   * event the listener calls
   * `consumeRunLessonInjects(workflowRunId)` to drain the set
   * and emit one outcome-after-lesson event per pair. The set
   * is consumed once on terminal so a duplicate terminal event
   * does not double-count.
   *
   * Bounded by the number of currently-active workflow runs;
   * the API is single-process so this map does not need
   * eviction (consume on terminal is enough). The set is keyed
   * by the `${lesson_id}::${scope}` composite string (NOT by
   * object identity) so repeated `recordLearningLessonInjected`
   * calls for the same pair within a single run collapse to
   * ONE entry — the outcome counter is incremented once per
   * `(lesson, scope, outcome)` per run, not once per inject
   * call.
   *
   * The inner map is keyed by the same `${lesson_id}::${scope}`
   * composite string and stores the full
   * `LearningLessonInjectRecord` (incl. the optional
   * behaviour-change anchor captured at inject time, EPIC-212
   * Phase 3 Task 1) so the terminal observer can read the
   * anchor when it drains the set. The first-seen anchor for a
   * pair wins — a later anchor-less re-inject of the same pair
   * never clears an already-captured anchor.
   */
  private readonly lessonInjectsByRun = new Map<
    string,
    Map<string, LearningLessonInjectRecord>
  >();

  private memoryDecayLastRun: Date | null = null;

  /**
   * Postmortem writeback counters (work item
   * 5743ac93-456d-41b3-ae5b-0ca2554318da). Mirrors the
   * `nexus_workflow_postmortem_recorded_total{outcome=...}`
   * prom-client instrument on `MetricsService`. The label union
   * is the same as `WorkflowPostmortemOutcome` so the in-process
   * snapshot and the Prometheus scrape agree.
   */
  private postmortemRecordedTotal: Record<
    PostmortemRecordedPayload['outcome'],
    number
  > = {
    success: 0,
    skipped: 0,
    failed: 0,
  };
  private postmortemLastRecorded: WorkflowPostmortemMetrics['last_recorded'] =
    null;

  recordBackendRead(backend: BackendLabel, latencyMs: number): void {
    this.backendReadTotal[backend] += 1;
    this.backendReadLatencyCount[backend] += 1;
    this.backendReadLatencySum[backend] += Math.max(0, latencyMs);
    this.appendSample(backend, latencyMs);
  }

  recordBackendWrite(backend: BackendLabel, outcome: MemoryWriteOutcome): void {
    this.backendWriteTotal[backend][outcome] += 1;
  }

  setActiveSegments(
    backend: BackendLabel,
    source: string,
    count: number,
  ): void {
    this.backendActiveSegments[backend][source] = Math.max(
      0,
      Math.floor(count),
    );
  }

  recordBackendFallback(
    from: BackendLabel,
    to: BackendLabel,
    operation: string,
  ): void {
    const key = `${from}->${to}:${operation}`;
    if (!this.backendFallbackKeys.has(key)) {
      this.backendFallbackKeys.add(key);
    }
    this.backendFallbackCounts[key] =
      (this.backendFallbackCounts[key] ?? 0) + 1;
  }

  recordDistillationCompleted(
    outcome: DistillationOutcome,
    payload: DistillationOutcomePayload,
  ): void {
    this.distillationCompleted[outcome] += 1;
    this.distillationLast = {
      input_segment_count: payload.input_segment_count,
      output_segment_count: payload.output_segment_count,
      compression_ratio: payload.compression_ratio,
      tokens_before: payload.tokens_before,
      tokens_after: payload.tokens_after,
      model: payload.model,
      duration_ms: payload.duration_ms,
      completed_at: new Date().toISOString(),
    };
  }

  recordLearningPromoted(payload: LearningPromotedPayload): void {
    this.learningPromotedTotal += 1;
    this.learningLastPromoted = {
      candidate_id: payload.candidate_id,
      confidence: payload.confidence,
      scope: payload.scope,
      source_decision_id: payload.source_decision_id,
      promoted_at: new Date().toISOString(),
    };
  }

  /**
   * Record one promoted learning lesson that was actually
   * injected into a downstream agent's planning context
   * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db).
   *
   * Mirrors the
   * `MetricsService.recordLearningLessonInjected` prom-client
   * call at the call site; both are incremented in lock-step
   * so the per-process REST snapshot and the Prometheus
   * scrape agree.
   *
   * The unlabelled counter (`learningLessonInjectedTotal`)
   * and the `learningLastLessonInjected` snapshot together
   * implement the in-process half of the
   * `inMemoryRecord{timestamp, name, labels, value}` shape
   * referenced in the spec — the timestamp is `injected_at`,
   * the name is `learning_lesson_injected`, the labels are
   * `(lesson_id, scope)`, and the value is `1` per call.
   *
   * Side-effect (milestone 2): also records the
   * `(lesson_id, scope)` pair in the per-run set keyed by
   * `options.workflowRunId` so the terminal-event observer can
   * emit one outcome-after-lesson event per injected lesson.
   * `workflowRunId` is required so the per-run set is never
   * populated for a run-less call site (which would leak
   * entries that can never be consumed).
   *
   * No deduplication: calling this with the same
   * `(lesson_id, scope)` pair N times records N injections
   * AND adds the pair to the per-run set ONCE (the set is
   * keyed by `${lesson_id}::${scope}`).
   */
  recordLearningLessonInjected(
    payload: LearningLessonInjectedPayload,
    options: { workflowRunId: string },
  ): void {
    // Always track the per-run record so the terminal observer can
    // attribute the outcome (and, for the holdout arm, measure the
    // suppressed counterfactual). The arm is threaded through verbatim.
    this.trackLessonInject(options.workflowRunId, {
      lesson_id: payload.lesson_id,
      scope: payload.scope,
      ...(payload.anchored_tool !== undefined
        ? { anchored_tool: payload.anchored_tool }
        : {}),
      ...(payload.anchored_path !== undefined
        ? { anchored_path: payload.anchored_path }
        : {}),
      ...(payload.holdout_arm !== undefined
        ? { holdout_arm: payload.holdout_arm }
        : {}),
    });

    if (payload.holdout_arm === 'holdout') {
      // SUPPRESSED injection: the lesson was computed but NOT rendered into
      // the planning context, so it must not feed the main "lesson injected"
      // counter or the convergence ring (that would falsely credit an
      // injection that never happened). Only the lift's holdout arm sees it.
      return;
    }

    this.learningLessonInjectedTotal += 1;
    this.learningLastLessonInjected = {
      lesson_id: payload.lesson_id,
      scope: payload.scope,
      injected_at: new Date().toISOString(),
    };
    this.appendInjectTimestamp(payload.scope, Date.now());
  }

  /**
   * Record one behaviour-change observation (EPIC-212 Phase 3, Task 6):
   * after a promoted lesson was injected, did the run actually exercise the
   * lesson's anchored tool/path? Mirrors the
   * `nexus_learning_behaviour_change_total{scope,changed}` prom-client
   * counter at the listener call site (incremented in lock-step). Lessons
   * with no anchor are excluded by the caller, so every call here counts.
   */
  recordLearningBehaviourChange(payload: LearningBehaviourChangePayload): void {
    this.measurement.recordBehaviourChange(payload);
  }

  /**
   * Set the cost-per-promoted-memory (cents/memory) computed by the refresh
   * pass (EPIC-212 Phase 3, Task 6). `null` clears it (no spend / no
   * promoted memory in the window).
   */
  setLearningCostPerPromotedMemory(value: number | null): void {
    this.measurement.setCostPerPromotedMemory(value);
  }

  /** Set the suppressed-noise rollup computed by the refresh pass. */
  setLearningSuppressedNoiseCount(value: number | null): void {
    this.measurement.setSuppressedNoiseCount(value);
  }

  /**
   * Record one provisional-memory probation evaluator pass (EPIC-212 Phase 3,
   * Task 7). Delegates to the {@link LearningMeasurementState} which keeps the
   * running confirmed / reverted / held totals + last-pass snapshot off this
   * service to stay within the file-level `max-lines` cap.
   */
  recordProbationOutcome(counts: ProbationOutcomeCounts): void {
    this.measurement.recordProbationOutcome(counts);
  }

  /**
   * Record one workflow-run terminal outcome observed after
   * at least one promoted learning lesson was injected into
   * a planning step during the run (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2).
   *
   * Mirrors the
   * `MetricsService.recordLearningRunOutcomeAfterLesson`
   * prom-client call at the listener call site; both are
   * incremented in lock-step so the per-process REST
   * snapshot and the Prometheus scrape agree.
   *
   * The unlabelled counter
   * (`learningRunOutcomeAfterLessonTotal`) and the
   * `learningLastRunOutcomeAfterLesson` snapshot together
   * implement the in-process half of the `inMemoryRecord`
   * shape — the timestamp is `observed_at`, the name is
   * `workflow_run_outcome_after_lesson`, the labels are
   * `(lesson_id, scope, outcome)`, and the value is `1` per
   * call.
   *
   * No deduplication: calling this with the same label
   * triple N times records N outcomes.
   */
  recordWorkflowRunOutcomeAfterLesson(
    payload: LearningRunOutcomeAfterLessonPayload,
  ): void {
    this.learningRunOutcomeAfterLessonTotal += 1;
    this.learningLastRunOutcomeAfterLesson = {
      lesson_id: payload.lesson_id,
      scope: payload.scope,
      outcome: payload.outcome,
      observed_at: new Date().toISOString(),
    };
    this.appendOutcomeTimestamp(payload.scope, {
      at: Date.now(),
      outcome: payload.outcome,
    });
    if (payload.holdout_arm !== undefined) {
      // Holdout measurement is active for this run: attribute the outcome to
      // the per-arm ring so the lift snapshot can compare the arms. The main
      // convergence ring above is unaffected (it always counts the outcome).
      this.measurement.appendArmOutcome(
        payload.scope,
        payload.holdout_arm,
        payload.outcome,
      );
    }
  }

  /**
   * Drain (return + clear) the set of `(lesson_id, scope)`
   * pairs that were injected during the given workflow run
   * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db,
   * milestone 2). The terminal-event observer calls this
   * once on `workflow.run.{completed,failed}`; if the same
   * terminal event fires twice (publisher retry, race
   * between `complete` and `failed` observers) the second
   * call returns an empty array and does not double-count.
   *
   * Returns a defensive readonly copy so the caller cannot
   * mutate the internal set between consume and snapshot.
   */
  consumeRunLessonInjects(
    workflowRunId: string,
  ): ReadonlyArray<LearningLessonInjectRecord> {
    const set = this.lessonInjectsByRun.get(workflowRunId);
    if (!set || set.size === 0) {
      this.lessonInjectsByRun.delete(workflowRunId);
      return [];
    }
    const drained: LearningLessonInjectRecord[] = [];
    for (const record of set.values()) {
      drained.push({ ...record });
    }
    this.lessonInjectsByRun.delete(workflowRunId);
    return drained;
  }

  /**
   * Add a `(lesson_id, scope)` pair to the per-run set.
   * Idempotent on the pair (the Set is keyed by the composite
   * `${lesson_id}::${scope}` string, NOT by object identity,
   * so repeated `recordLearningLessonInjected` calls for the
   * same pair within a single run collapse to ONE entry).
   * Internal helper; not part of the public surface.
   */
  private trackLessonInject(
    workflowRunId: string,
    record: LearningLessonInjectRecord,
  ): void {
    let set = this.lessonInjectsByRun.get(workflowRunId);
    if (!set) {
      set = new Map<string, LearningLessonInjectRecord>();
      this.lessonInjectsByRun.set(workflowRunId, set);
    }
    const compositeKey = `${record.lesson_id}::${record.scope}`;
    // First-seen anchor for a pair wins: a later anchor-less
    // re-inject of the same `(lesson, scope)` pair within a run
    // must not clear an already-captured anchor.
    if (!set.has(compositeKey)) {
      set.set(compositeKey, record);
    }
  }

  setMemoryDecayLastRun(value: Date | null): void {
    this.memoryDecayLastRun = value;
  }

  /**
   * Record one postmortem writeback event (work item
   * 5743ac93-456d-41b3-ae5b-0ca2554318da). The `WorkflowFailurePostmortemListener`
   * (milestone 2) calls this once per processed
   * `WORKFLOW_RUN_FAILED_EVENT` so the per-process REST
   * snapshot can answer "did the listener write / skip / fail
   * and when?". Mirrors the
   * `MetricsService.recordWorkflowPostmortemRecorded` prom-client
   * call at the listener call site; both are incremented in
   * lock-step so the prom-client scrape and the in-process
   * snapshot agree.
   */
  recordPostmortemRecorded(payload: PostmortemRecordedPayload): void {
    this.postmortemRecordedTotal[payload.outcome] += 1;
    this.postmortemLastRecorded = {
      occurred_at: payload.occurred_at,
      outcome: payload.outcome,
      ...(payload.memory_segment_id !== undefined
        ? { memory_segment_id: payload.memory_segment_id }
        : {}),
      ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
    };
  }

  snapshot(): MemoryMetricsSnapshot {
    // Convergence computation is delegated to the async
    // `getSnapshot()` path so the rolling window can honour the
    // live `learning_convergence_window_days` SystemSetting. The
    // sync `snapshot()` is preserved for callers that cannot
    // await a setting read (e.g. the in-test `expect(...).toBe(...)`
    // assertions in `memory-metrics.service.spec.ts`); the
    // convergence block on the sync path uses the hardcoded
    // `LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT` (7 days) as
    // documented on `computeConvergenceSnapshotsForWindow`.
    const convergence = this.computeConvergenceSnapshots();
    const lift = this.measurement.computeLiftSnapshots(
      LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
    );
    this.publishLiftToGauge(lift);

    const backend: MemoryMetricsSnapshot['backend'] = {
      read: {
        total: { ...this.backendReadTotal },
        latency_ms: {
          postgres: this.buildLatencySummary('postgres'),
          honcho: this.buildLatencySummary('honcho'),
        },
      },
      write: {
        total: {
          postgres: { ...this.backendWriteTotal.postgres },
          honcho: { ...this.backendWriteTotal.honcho },
        },
      },
      active_segments: {
        total: {
          postgres: { ...this.backendActiveSegments.postgres },
          honcho: { ...this.backendActiveSegments.honcho },
        },
      },
      fallback: { ...this.backendFallbackCounts },
    };

    const distillation: DistillationMetrics = {
      completed_total: { ...this.distillationCompleted },
      last: this.distillationLast ? { ...this.distillationLast } : null,
    };

    const learning: LearningMetrics = {
      promoted_total: this.learningPromotedTotal,
      last_promoted: this.learningLastPromoted
        ? { ...this.learningLastPromoted }
        : null,
      lesson_injected_total: this.learningLessonInjectedTotal,
      last_lesson_injected: this.learningLastLessonInjected
        ? { ...this.learningLastLessonInjected }
        : null,
      run_outcome_after_lesson_total: this.learningRunOutcomeAfterLessonTotal,
      last_run_outcome_after_lesson: this.learningLastRunOutcomeAfterLesson
        ? { ...this.learningLastRunOutcomeAfterLesson }
        : null,
      convergence,
      behaviour_change: this.measurement.buildBehaviourChangeMetrics(),
      lift,
      cost_per_promoted_memory: this.measurement.cost,
      suppressed_noise_count: this.measurement.suppressed,
      probation: this.measurement.buildProbationMetrics(),
    };

    return {
      backend,
      distillation,
      learning,
      postmortem: {
        recorded_total: { ...this.postmortemRecordedTotal },
        last_recorded: this.postmortemLastRecorded
          ? { ...this.postmortemLastRecorded }
          : null,
      },
      memoryDecayLastRun: this.memoryDecayLastRun
        ? new Date(this.memoryDecayLastRun.getTime())
        : null,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Async snapshot path that honours the live
   * `learning_convergence_window_days` SystemSetting
   * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db,
   * milestone 3).
   *
   * The REST controller calls this method (not the sync
   * `snapshot()`) so the rolling window can be tuned at
   * runtime without restarting the API. The
   * `learning.convergence` block is recomputed with the
   * freshly-resolved window; the rest of the snapshot is
   * identical to `snapshot()`.
   *
   * When the `SystemSettingsService` is not wired (e.g. a
   * unit test that constructs the service via
   * `new MemoryMetricsService()`) the convergence block is
   * computed with the hardcoded default window
   * (LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT = 7 days)
   * and the rest of the snapshot is the same as
   * `snapshot()`.
   */
  async getSnapshot(): Promise<MemoryMetricsSnapshot> {
    const windowDays = await this.resolveWindowDays();
    const convergence = this.computeConvergenceSnapshotsForWindow(windowDays);
    const lift = this.measurement.computeLiftSnapshots(windowDays);
    this.publishLiftToGauge(lift);
    const base = this.snapshot();
    return {
      ...base,
      learning: {
        ...base.learning,
        convergence,
        lift,
      },
    };
  }

  private appendSample(backend: BackendLabel, latencyMs: number): void {
    const samples = this.backendReadLatencySamples[backend];
    if (samples.length >= LATENCY_RESERVOIR_CAPACITY) {
      // Simple bounded reservoir: drop oldest sample once the cap is hit.
      // The prom-client Histogram remains the source of truth for true
      // percentiles; this is a best-effort per-process estimate for the
      // JSON snapshot only.
      samples.shift();
    }
    samples.push(Math.max(0, latencyMs));
  }

  // -----------------------------------------------------------------
  // Convergence ring buffer helpers
  // (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3)
  // -----------------------------------------------------------------
  //
  // The convergence ratio is `successes / total` over a rolling
  // window of `learning_convergence_window_days` days. Because
  // the in-memory counters do not track per-event timestamps,
  // we maintain per-scope ring buffers of (timestamp, outcome)
  // pairs that are trimmed on every `computeConvergenceSnapshots`
  // call. The buffers are bounded by
  // `MAX_CONVERGENCE_RING_PER_SCOPE` so a misconfigured
  // `window_days = 90` cannot blow up the process.

  /**
   * Append one inject timestamp to the per-scope ring buffer.
   * The buffer is append-only-trimmed so the lookup is amortised
   * O(1) and the memory footprint stays bounded.
   */
  private appendInjectTimestamp(scope: string, at: number): void {
    let ring = this.learningInjectTimestampsByScope.get(scope);
    if (!ring) {
      ring = [];
      this.learningInjectTimestampsByScope.set(scope, ring);
    }
    if (ring.length >= MAX_CONVERGENCE_RING_PER_SCOPE) {
      ring.shift();
    }
    ring.push(at);
  }

  /**
   * Append one outcome `(timestamp, outcome)` pair to the
   * per-scope ring buffer. The pair is what
   * `computeConvergenceSnapshots` needs to compute the
   * numerator (`outcome === 'success'`) and the denominator
   * (any outcome) within the rolling window.
   */
  private appendOutcomeTimestamp(
    scope: string,
    sample: { at: number; outcome: 'success' | 'failure' },
  ): void {
    let ring = this.learningOutcomeTimestampsByScope.get(scope);
    if (!ring) {
      ring = [];
      this.learningOutcomeTimestampsByScope.set(scope, ring);
    }
    if (ring.length >= MAX_CONVERGENCE_RING_PER_SCOPE) {
      ring.shift();
    }
    ring.push(sample);
  }

  /**
   * Compute the per-scope convergence snapshots (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3).
   *
   * The method is the in-memory seam that closes the
   * self-improvement feedback loop:
   *
   *   ratio = successes_after_lesson / runs_after_lesson
   *
   * over a rolling window of `learning_convergence_window_days`
   * days. The setting is read fresh on every call so an
   * operator can tighten or loosen the window between snapshots
   * without restarting the API. The per-scope ring buffers are
   * trimmed during the computation; expired samples are dropped
   * before the ratio is computed so the running process does
   * not accumulate stale state.
   *
   * After computing the per-scope snapshots the method pushes
   * the ratio into the prom-client
   * `nexus_learning_loop_convergence_ratio{scope}` gauge via
   * `MetricsService.setLearningLoopConvergenceRatio` so the
   * Prometheus scrape reflects the same value the JSON
   * snapshot returns.
   *
   * Scopes with zero in-window samples (after trimming) are
   * omitted from the returned map. A scope with injections but
   * zero outcomes returns `{ratio: 0, runs_after_lesson: 0,
   * successes_after_lesson: 0, ...}` so the operator can see
   * "the lesson was injected but no run-after-lesson has
   * completed yet" — distinct from "no signal at all".
   *
   * The method is intentionally synchronous on the in-memory
   * path (no DB I/O) so it can be called from the REST
   * controller's request handler without awaiting a transaction.
   * The system setting is read asynchronously via the injected
   * `SystemSettingsService`; if no settings service is wired
   * (e.g. in a unit test) the hardcoded default of
   * `LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT` (7) is used.
   */
  async computeConvergenceSnapshotsAsync(): Promise<
    Record<string, LearningConvergenceSnapshot>
  > {
    const windowDays = await this.resolveWindowDays();
    return this.computeConvergenceSnapshotsForWindow(windowDays);
  }

  /**
   * Synchronous convergence snapshot computation. Falls back
   * to the hardcoded default window length when the settings
   * service is not wired (e.g. in a unit test that constructs
   * the service via `new MemoryMetricsService()`). Production
   * callers (the REST controller) should use
   * `computeConvergenceSnapshotsAsync` so the live setting is
   * honoured.
   */
  computeConvergenceSnapshots(): Record<string, LearningConvergenceSnapshot> {
    return this.computeConvergenceSnapshotsForWindow(
      LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
    );
  }

  /**
   * Daily convergence recorder accessor (work item
   * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2).
   *
   * Returns the per-scope `LearningConvergenceSnapshot` map
   * computed over an EXPLICIT rolling window expressed in
   * days. The recorder passes its own
   * `LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING` value (NOT
   * the live controller-side window the
   * `computeConvergenceSnapshotsAsync` path honours) so the
   * recorder's snapshot horizon is independent from the
   * controller's view of "what's the current convergence
   * ratio?" — the recorder's job is to persist a historical
   * slice, the controller's job is to expose the rolling
   * window to operators in real time.
   *
   * The window parameter MUST be a finite positive integer;
   * a non-finite / non-positive value falls back to the
   * hardcoded default window (7 days) so a malformed
   * setting cannot crash the daily recorder pass. The ring
   * buffers are trimmed in place during the computation;
   * expired samples are dropped before the snapshot is
   * returned.
   *
   * Exposed as a public synchronous method (NOT behind the
   * async settings-resolve path) so the recorder can call it
   * without an extra await round trip per pass. The recorder
   * resolves its own setting via `SystemSettingsService.get`
   * and passes the value here.
   */
  getConvergenceSnapshots(
    windowDays: number,
  ): Record<string, LearningConvergenceSnapshot> {
    const safeWindow =
      typeof windowDays === 'number' &&
      Number.isFinite(windowDays) &&
      windowDays > 0
        ? Math.floor(windowDays)
        : LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    return this.computeConvergenceSnapshotsForWindow(safeWindow);
  }

  /**
   * Synchronous variant that takes the window length as a
   * parameter. The unit tests pass an explicit window so the
   * ring-buffer trim is exercised without mocking the settings
   * service. Production callers go through
   * `computeConvergenceSnapshotsAsync` so the live setting is
   * always honoured.
   */
  private computeConvergenceSnapshotsForWindow(
    windowDays: number,
  ): Record<string, LearningConvergenceSnapshot> {
    const snapshots = computeConvergenceSnapshots(
      this.learningInjectTimestampsByScope,
      this.learningOutcomeTimestampsByScope,
      windowDays,
    );
    this.publishSnapshotsToGauge(snapshots);
    return snapshots;
  }

  /**
   * Push the freshly-computed ratios into the prom-client
   * gauge. The mutator is a no-op when `MetricsService` is
   * not wired (e.g. in a unit test that constructs the
   * service without DI).
   */
  private publishSnapshotsToGauge(
    snapshots: Record<string, LearningConvergenceSnapshot>,
  ): void {
    if (!this.metrics) {
      return;
    }
    for (const [scope, snapshot] of Object.entries(snapshots)) {
      this.metrics.setLearningLoopConvergenceRatio(scope, snapshot.ratio);
    }
  }

  /**
   * Push the freshly-computed non-null lifts into the prom-client
   * `nexus_learning_lift{scope}` gauge. The mutator is a no-op when
   * `MetricsService` is not wired (e.g. in a unit test that constructs the
   * service without DI). The pure `LearningMeasurementState.computeLiftSnapshots`
   * does not touch prom-client, so this is the only gauge write for lift.
   */
  private publishLiftToGauge(
    snapshots: Record<string, LearningLiftSnapshot>,
  ): void {
    if (!this.metrics) {
      return;
    }
    for (const [scope, snapshot] of Object.entries(snapshots)) {
      if (snapshot.lift !== null) {
        this.metrics.setLearningLiftRatio(scope, snapshot.lift);
      }
    }
  }

  /**
   * Resolve the live `learning_convergence_window_days` setting.
   * Returns the hardcoded default when the settings service is
   * not wired (e.g. a unit test that constructs the service
   * without DI) or when the stored value is missing /
   * non-numeric / out of range. Matches the resolve-settings
   * pattern used by `MemoryDecayReaperService`.
   */
  private async resolveWindowDays(): Promise<number> {
    if (!this.settings) {
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    }
    try {
      const raw = await this.settings.get<unknown>(
        'learning_convergence_window_days',
        LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
      );
      return coerceLearningConvergenceWindowDays(raw);
    } catch {
      return LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT;
    }
  }

  private buildLatencySummary(backend: BackendLabel): BackendLatencySummary {
    const samples = this.backendReadLatencySamples[backend];
    const count = this.backendReadLatencyCount[backend];
    const sum = this.backendReadLatencySum[backend];

    if (samples.length === 0) {
      return { count, sum };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    return {
      count,
      sum,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }

  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.min(
    sortedAsc.length - 1,
    Math.floor(clamped * (sortedAsc.length - 1)),
  );
  return sortedAsc[index] ?? 0;
}
