/**
 * Type contracts for per-backend memory observability counters and
 * distillation / learning outcome metrics.
 *
 * `BackendLabel` mirrors the labels we tag the prom-client instruments with
 * (see `MetricsService`); the in-memory snapshot keys its `Record<...>` maps
 * with the same union so the REST snapshot exposed in milestone 2 can be
 * consumed by dashboards and probes without further translation.
 */
import type { HoldoutArm } from './signals/holdout-bucket.types';

export type { HoldoutArm } from './signals/holdout-bucket.types';

export type BackendLabel = 'postgres' | 'honcho';

export type MemoryWriteOutcome = 'success' | 'failure';

export type DistillationOutcome = 'success' | 'failure' | 'skipped';

export interface BackendLatencySummary {
  count: number;
  sum: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

export interface BackendReadMetrics {
  total: Record<BackendLabel, number>;
  latency_ms: Record<BackendLabel, BackendLatencySummary>;
}

export interface BackendWriteMetrics {
  total: Record<BackendLabel, Record<MemoryWriteOutcome, number>>;
}

export interface BackendActiveSegmentsMetrics {
  total: Record<BackendLabel, Record<string, number>>;
}

export interface BackendMetrics {
  read: BackendReadMetrics;
  write: BackendWriteMetrics;
  active_segments: BackendActiveSegmentsMetrics;
  fallback: Record<string, number>;
}

export interface DistillationLastRun {
  input_segment_count: number;
  output_segment_count: number;
  compression_ratio: number;
  tokens_before: number;
  tokens_after: number;
  model: string;
  duration_ms: number;
  completed_at: string;
}

export interface DistillationMetrics {
  completed_total: Record<DistillationOutcome, number>;
  last: DistillationLastRun | null;
}

export interface LearningLastPromoted {
  candidate_id: string;
  confidence: number;
  scope: string;
  source_decision_id: string;
  promoted_at: string;
}

/**
 * Last-write snapshot for a promoted learning lesson that was
 * actually injected into an agent planning context (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db). Mirrors the
 * `nexus_learning_lesson_injected_total{lesson_id, scope}`
 * prom-client instrument on `MetricsService`.
 *
 * `lesson_id` is the promoted memory segment id (UUID);
 * `scope` is the resolved entity id the lesson was attached to
 * (typically a project UUID or a workflow run UUID). The
 * `injected_at` timestamp mirrors the `timestamp` leg of the
 * in-process `inMemoryRecord` shape (name + labels + value +
 * timestamp) used by the upstream `recordLearningPromoted`
 * pattern — the value here is implicitly `1` (one injection
 * event).
 */
export interface LearningLastLessonInjected {
  lesson_id: string;
  scope: string;
  injected_at: string;
}

/**
 * Last-write snapshot for a workflow-run terminal outcome
 * observed after at least one promoted learning lesson was
 * injected into a planning step during that run (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2). Mirrors
 * the `nexus_workflow_run_outcome_after_lesson_total{lesson_id,
 * scope, outcome}` prom-client instrument on `MetricsService`.
 *
 * `lesson_id` is the promoted memory segment id (UUID);
 * `scope` is the resolved scope id the run was attached to;
 * `outcome` is the closed enum `success` | `failure`.
 * `observed_at` mirrors the `timestamp` leg of the in-process
 * `inMemoryRecord` shape — the value here is implicitly `1`
 * (one outcome-after-lesson event).
 */
export interface LearningLastRunOutcomeAfterLesson {
  lesson_id: string;
  scope: string;
  outcome: 'success' | 'failure';
  observed_at: string;
}

/**
 * Per-scope convergence snapshot (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). Closes
 * the self-improvement feedback loop by dividing the
 * `success_outcome_count` numerator by the
 * `total_outcome_count` denominator, both observed within the
 * rolling window of
 * `learning_convergence_window_days` days.
 *
 * `window_days` is captured per-scope so a per-snapshot
 * change to the setting surfaces in the response without an
 * extra round trip. `computed_at` is the wall-clock timestamp
 * of the snapshot so consumers can detect "the gauge is stale"
 * without recomputing the window themselves.
 *
 * `runs_after_lesson` and `successes_after_lesson` are the raw
 * counts behind the ratio — included so an operator can sanity
 * check "ratio = 0.5 from 2/4" vs "ratio = 0.5 from 50/100".
 *
 * `ratio` is `0` when `runs_after_lesson === 0` (no signal
 * available). The block is omitted entirely from
 * `MemoryMetricsService.learning.convergence` when the scope
 * has zero injections AND zero outcomes in the window — an
 * empty map is the "no data" signal.
 */
export interface LearningConvergenceSnapshot {
  ratio: number;
  window_days: number;
  runs_after_lesson: number;
  successes_after_lesson: number;
  computed_at: string;
}

/** Per-arm run tally exposed alongside the lift snapshot. */
export interface LearningLiftArmSnapshot {
  ratio: number;
  runs: number;
  successes: number;
}

/**
 * Per-scope A/B holdout lift snapshot (EPIC-212 Phase 3, Task 6).
 *
 * `lift = convergence(injected_arm) − convergence(holdout_arm)`, or `null`
 * when the holdout arm has no in-window runs (the default state when
 * `learning_holdout_fraction = 0`, so the loop's behaviour is unchanged).
 * Pushed to the `nexus_learning_lift{scope}` gauge when non-null.
 */
export interface LearningLiftSnapshot {
  lift: number | null;
  injected: LearningLiftArmSnapshot;
  holdout: LearningLiftArmSnapshot;
  window_days: number;
  computed_at: string;
}

/**
 * Behaviour-change counter snapshot (EPIC-212 Phase 3, Task 6). Counts, for
 * lessons that carried a behaviour-change anchor, whether the run actually
 * exercised the anchored tool/path after injection. The per-(scope, changed)
 * breakdown lives in the `nexus_learning_behaviour_change_total` prom-client
 * counter; this block mirrors the unlabelled totals for the REST snapshot.
 * Lessons with no anchor are never counted (no false negatives).
 */
export interface LearningBehaviourChangeMetrics {
  changed_total: number;
  unchanged_total: number;
  last: LearningLastBehaviourChange | null;
}

export interface LearningLastBehaviourChange {
  lesson_id: string;
  scope: string;
  changed: boolean;
  observed_at: string;
}

/**
 * Probation evaluator outcome counts for a single pass (EPIC-212 Phase 3,
 * Task 7). `confirmed` = provisional auto-promotions whose probation elapsed
 * and self-confirmed; `reverted` = bad auto-promotions archived (auto-revert
 * flag on); `held` = left untouched for a future pass (inside probation,
 * insufficient votes, or a would-revert running in shadow mode).
 */
export interface ProbationOutcomeCounts {
  confirmed: number;
  reverted: number;
  held: number;
}

/** Last-pass snapshot for the probation evaluator. */
export interface LearningLastProbationPass {
  confirmed: number;
  reverted: number;
  held: number;
  observed_at: string;
}

/**
 * Probation evaluator metrics block (EPIC-212 Phase 3, Task 7). Accumulates
 * the per-pass {@link ProbationOutcomeCounts} into running totals plus the
 * most-recent pass for operator visibility on the Learning Health panel.
 * All zero / `null` until the evaluator runs (default-OFF leaves it inert).
 */
export interface LearningProbationMetrics {
  confirmed_total: number;
  reverted_total: number;
  held_total: number;
  last_pass: LearningLastProbationPass | null;
}

export interface LearningMetrics {
  promoted_total: number;
  last_promoted: LearningLastPromoted | null;
  /**
   * "Use" leg of the self-improvement feedback loop
   * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db).
   * Counts only injections that actually entered an agent's
   * planning context — distinct from `promoted_total` which
   * counts promotions only. The counter itself is label-free
   * (the per-(lesson_id, scope) breakdown lives in the
   * `nexus_learning_lesson_injected_total` prom-client
   * instrument on `MetricsService`); the snapshot only carries
   * the most-recent injection for operator visibility.
   */
  lesson_injected_total: number;
  last_lesson_injected: LearningLastLessonInjected | null;
  /**
   * Convergence-side counter (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2).
   * Counts terminal workflow-run outcomes observed AFTER at
   * least one promoted learning lesson was injected into a
   * planning step during the run. The per-(lesson_id, scope,
   * outcome) breakdown lives in the
   * `nexus_workflow_run_outcome_after_lesson_total`
   * prom-client instrument on `MetricsService`; this unlabelled
   * counter mirrors it for the per-process REST snapshot.
   * Milestone 3 will divide `lesson_injected_total` /
   * `run_outcome_after_lesson_total` to compute the
   * convergence ratio.
   */
  run_outcome_after_lesson_total: number;
  last_run_outcome_after_lesson: LearningLastRunOutcomeAfterLesson | null;
  /**
   * Convergence snapshots keyed by `scope` (work item
   * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). Each
   * value is the per-scope
   * `{ratio, window_days, runs_after_lesson, successes_after_lesson, computed_at}`
   * tuple computed from the in-memory
   * `learning_lesson_injected_total` / `learning_run_outcome_after_lesson_total`
   * history within the rolling window. The block is always
   * present; a scope with no in-window signal is omitted from
   * the map.
   *
   * Computed at `MemoryMetricsService.snapshot()` time and
   * pushed to the `nexus_learning_loop_convergence_ratio{scope}`
   * prom-client gauge via
   * `MetricsService.setLearningLoopConvergenceRatio`.
   */
  convergence: Record<string, LearningConvergenceSnapshot>;
  /**
   * Behaviour-change counter (EPIC-212 Phase 3, Task 6). Read-only
   * measurement: did runs actually exercise an injected lesson's anchored
   * tool/path? Default-on; lessons with no anchor are excluded.
   */
  behaviour_change: LearningBehaviourChangeMetrics;
  /**
   * Per-scope A/B holdout lift (EPIC-212 Phase 3, Task 6). Empty `{}` when
   * no holdout arm has been measured (`learning_holdout_fraction = 0`); each
   * present entry carries `lift = injected − holdout` (or `null` when that
   * scope's holdout arm is empty in the window).
   */
  lift: Record<string, LearningLiftSnapshot>;
  /**
   * Cost-per-promoted-memory (EPIC-212 Phase 3, Task 6):
   * `(analyst + embedding spend in window) / promoted count in window`,
   * in cents per promoted memory. `null` when there is no spend or no
   * promoted memory in the window. Computed by the refresh pass.
   */
  cost_per_promoted_memory: number | null;
  /**
   * Suppressed-noise rollup (EPIC-212 Phase 3, Task 6): the count of
   * learning candidates the dedup/template sweep merged away (the
   * `learning_candidates.status = 'merged'` set). `null` when the count is
   * not available (e.g. the candidate repository is not wired). Computed by
   * the refresh pass.
   */
  suppressed_noise_count: number | null;
  /**
   * Provisional-memory probation evaluator rollup (EPIC-212 Phase 3, Task 7).
   * Confirmed / reverted / held totals plus the most-recent pass. All zero /
   * `null` until the evaluator runs (default-OFF leaves it inert).
   */
  probation: LearningProbationMetrics;
}

/**
 * Per-outcome counter for the
 * `WorkflowFailurePostmortemListener` (work item
 * 5743ac93-456d-41b3-ae5b-0ca2554318da). Mirrors the
 * `nexus_workflow_postmortem_recorded_total{outcome=...}`
 * prom-client instrument on `MetricsService` so the per-process
 * REST snapshot and the Prometheus scrape agree.
 */
export interface WorkflowPostmortemRecordedTotal {
  success: number;
  skipped: number;
  failed: number;
}

/**
 * Last-write snapshot for the postmortem writeback pipeline.
 * `null` until the listener has run at least once; updated on
 * every processed `WORKFLOW_RUN_FAILED_EVENT`, regardless of
 * outcome (the milestone-2 operator surface cares about the
 * "was the listener awake" signal, not just successful writes).
 */
export interface WorkflowPostmortemLastRecorded {
  occurred_at: string;
  outcome: 'success' | 'skipped' | 'failed';
  memory_segment_id?: string;
  reason?: string;
}

export interface WorkflowPostmortemMetrics {
  recorded_total: WorkflowPostmortemRecordedTotal;
  last_recorded: WorkflowPostmortemLastRecorded | null;
}

/**
 * Single-process, in-memory snapshot of memory observability counters.
 *
 * Mirrors the prom-client instruments declared on `MetricsService` so the
 * REST endpoint in milestone 2 can return the same data the Prometheus
 * scrape exposes.
 */
export interface MemoryMetricsSnapshot {
  backend: BackendMetrics;
  distillation: DistillationMetrics;
  learning: LearningMetrics;
  /**
   * Postmortem writeback observability snapshot (work item
   * 5743ac93-456d-41b3-ae5b-0ca2554318da). Mirrors the
   * `nexus_workflow_postmortem_recorded_total{outcome=...}`
   * prom-client instrument on `MetricsService` so the per-process
   * REST snapshot and the Prometheus scrape agree. The block is
   * always present (with zero counters / `null` last-record)
   * even when the listener has not run yet.
   */
  postmortem: WorkflowPostmortemMetrics;
  /**
   * Wall-clock timestamp of the most recent `MemoryDecayReaper` pass.
   * `null` until the reaper has run at least once. Updated on every
   * pass — including pass-throughs (kill switch, empty candidate set)
   * — so the snapshot always reflects "the reaper was awake".
   */
  memoryDecayLastRun: Date | null;
  generated_at: string;
}

/** Payload for `MemoryMetricsService.recordDistillationCompleted`. */
export interface DistillationOutcomePayload {
  input_segment_count: number;
  output_segment_count: number;
  compression_ratio: number;
  tokens_before: number;
  tokens_after: number;
  model: string;
  duration_ms: number;
}

/** Payload for `MemoryMetricsService.recordLearningPromoted`. */
export interface LearningPromotedPayload {
  candidate_id: string;
  confidence: number;
  scope: string;
  source_decision_id: string;
}

/**
 * Payload for `MemoryMetricsService.recordLearningLessonInjected`
 * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db).
 *
 * `lesson_id` is the promoted memory segment id (UUID);
 * `scope` is the resolved entity id the lesson was attached to
 * (typically a project UUID or a workflow run UUID).
 *
 * `anchored_tool` / `anchored_path` are the OPTIONAL
 * behaviour-change anchor derived from the injected segment's
 * `metadata_json` at the call site (EPIC-212 Phase 3, Task 1).
 * They record the concrete runtime tool / code path the lesson
 * is about so the terminal-outcome observer can later attribute
 * behaviour-change (did the run actually exercise the anchored
 * tool / path after injection?). Both are strictly additive: a
 * lesson with no resolvable anchor omits them and records
 * exactly as before.
 */
export interface LearningLessonInjectedPayload {
  lesson_id: string;
  scope: string;
  anchored_tool?: string;
  anchored_path?: string;
  /**
   * A/B holdout arm this injection was attributed to (EPIC-212 Phase 3,
   * Task 6). Omitted when holdout measurement is off (`fraction = 0`), in
   * which case the record behaves exactly as before. `'holdout'` marks a
   * SUPPRESSED injection (the lesson was computed but NOT rendered into the
   * planning context) — the call site must not have injected it.
   */
  holdout_arm?: HoldoutArm;
}

/**
 * Payload for `MemoryMetricsService.recordLearningBehaviourChange`
 * (EPIC-212 Phase 3, Task 6). `changed` is whether the run actually
 * exercised the lesson's anchored tool/path after injection.
 */
export interface LearningBehaviourChangePayload {
  lesson_id: string;
  scope: string;
  changed: boolean;
}

/**
 * Payload for `MemoryMetricsService.recordWorkflowRunOutcomeAfterLesson`
 * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2).
 *
 * `lesson_id` is the promoted memory segment id (UUID);
 * `scope` is the resolved scope id the run was attached to
 * (typically a project UUID or a workflow run UUID);
 * `outcome` is the closed enum `success` | `failure` mirroring
 * `WorkflowStatus.{COMPLETED,FAILED}` (CANCELLED is excluded).
 */
export interface LearningRunOutcomeAfterLessonPayload {
  lesson_id: string;
  scope: string;
  outcome: 'success' | 'failure';
  /**
   * A/B holdout arm the run was attributed to (EPIC-212 Phase 3, Task 6),
   * carried over from the drained inject record. When present, the outcome
   * also feeds the per-arm lift ring; when absent (holdout off), only the
   * main convergence ring is updated.
   */
  holdout_arm?: HoldoutArm;
}

/**
 * Per-run inject tracking record (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2). One
 * record per `(lesson_id, scope)` pair that was injected during
 * a workflow run; the `MemoryMetricsService.consumeRunLessonInjects`
 * method drains the set on terminal so the same run cannot
 * double-count if a duplicate terminal event arrives.
 *
 * `anchored_tool` / `anchored_path` carry the OPTIONAL
 * behaviour-change anchor captured at inject time (EPIC-212
 * Phase 3, Task 1) through to the terminal observer. They are
 * omitted for a lesson with no resolvable anchor so the drained
 * record is byte-identical to the pre-capture shape.
 */
export interface LearningLessonInjectRecord {
  lesson_id: string;
  scope: string;
  anchored_tool?: string;
  anchored_path?: string;
  /**
   * A/B holdout arm captured at inject time (EPIC-212 Phase 3, Task 6),
   * threaded through to the terminal observer so the run outcome is
   * attributed to the correct arm for the lift measurement. Omitted when
   * holdout measurement is off.
   */
  holdout_arm?: HoldoutArm;
}

/**
 * Payload for `MemoryMetricsService.recordPostmortemRecorded`
 * (work item 5743ac93-456d-41b3-ae5b-0ca2554318da).
 *
 * `memory_segment_id` is omitted when the listener did not
 * produce a row (`skipped` and most `failed` outcomes);
 * `reason` is populated for `skipped` (kill switch off, dedup
 * hit, run was non-failed) and `failed` (the error that blocked
 * the writeback).
 */
export interface PostmortemRecordedPayload {
  outcome: 'success' | 'skipped' | 'failed';
  occurred_at: string;
  memory_segment_id?: string;
  reason?: string;
}
