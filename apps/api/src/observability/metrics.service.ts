import { Injectable, OnModuleInit } from '@nestjs/common';
import * as prometheus from 'prom-client';

import { registerContainerInstruments } from './instruments/container.instruments';
import { registerGitopsReconciliationTickCounter } from './instruments/gitops.instruments';
import { registerHttpAndAcpInstruments } from './instruments/http-acp.instruments';
import {
  registerLearningConvergenceGauge,
  registerLearningMeasurementMetrics,
  registerLearningMetrics,
  registerConvergenceRecorderMetrics,
} from './instruments/learning.instruments';
import {
  normaliseDriftMetricLabel,
  registerMemoryDriftMetric,
} from './instruments/memory-drift.instruments';
import { registerMemoryInstruments } from './instruments/memory.instruments';
import { registerMemoryLifecycleMetrics } from './instruments/memory-lifecycle.instruments';
import { registerOAuthLoginOrphanedMetric } from './instruments/oauth.instruments';
import { registerWorkflowInstruments } from './instruments/workflow.instruments';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: prometheus.Registry;

  // Workflow Metrics
  public readonly workflowExecutionDuration: prometheus.Histogram;
  public readonly workflowExecutionsTotal: prometheus.Counter;
  public readonly workflowsActive: prometheus.Gauge;

  // Container Metrics
  public readonly containerProvisioningDuration: prometheus.Histogram;
  public readonly containersActive: prometheus.Gauge;
  public readonly containerFailuresTotal: prometheus.Counter;

  // API Metrics
  public readonly httpRequestDuration: prometheus.Histogram;
  public readonly httpRequestsTotal: prometheus.Counter;

  // ACP Metrics
  public readonly acpServerDiscoveredAgents: prometheus.Gauge;
  public readonly acpInvokeDuration: prometheus.Histogram;
  public readonly acpInvokeTotal: prometheus.Counter;

  // Memory Metrics
  public readonly memoryBackendReadTotal: prometheus.Counter;
  public readonly memoryBackendWriteTotal: prometheus.Counter;
  public readonly memoryBackendReadLatencyMs: prometheus.Histogram;
  public readonly memoryBackendActiveSegments: prometheus.Gauge;
  public readonly memoryBackendFallbackTotal: prometheus.Counter;
  public readonly distillationCompletedTotal: prometheus.Counter;
  public readonly distillationCompressionRatio: prometheus.Histogram;
  public readonly learningPromotedTotal: prometheus.Counter;
  /**
   * Promoted learning lessons actually injected into an agent's
   * planning context (work item 88d7654e-...06db). Distinct from
   * `learningPromotedTotal` (promotions only). Labels: `lesson_id`
   * (UUID) × `scope` (entity UUID) — bounded cardinality.
   */
  public readonly learningLessonInjectedTotal: prometheus.Counter;
  /**
   * Workflow-run outcomes observed after at least one promoted
   * lesson was injected during the run (work item 88d7654e-...06db
   * milestone 2). Closes the self-improvement feedback loop;
   * milestone 3 uses it for the convergence ratio. Labels:
   * `lesson_id` × `scope` × `outcome` (closed enum
   * `success`|`failure`; cancellation intentionally excluded).
   */
  public readonly learningRunOutcomeAfterLessonTotal: prometheus.Counter;
  /**
   * Convergence ratio `success_outcome_count / total_outcome_count`
   * over a rolling window of `learning_convergence_window_days`
   * (work item 88d7654e-...06db milestone 3). Pushed by
   * `MemoryMetricsService.snapshot()`. Labelled by `scope`.
   */
  public readonly learningLoopConvergenceRatio: prometheus.Gauge;
  /**
   * Behaviour-change counter (EPIC-212 Phase 3 Task 6): for lessons
   * carrying a behaviour-change anchor, did the run exercise the
   * anchored tool/path after injection? Labels: `scope` × `changed`
   * (`true`|`false`). Incremented in lock-step with the in-memory
   * `MemoryMetricsService` mirror.
   */
  public readonly learningBehaviourChangeTotal: prometheus.Counter;
  /**
   * A/B holdout lift (EPIC-212 Phase 3 Task 6):
   * `convergence(injected_arm) − convergence(holdout_arm)` per
   * `scope`. Only set when the holdout arm has in-window runs
   * (`learning_holdout_fraction > 0`).
   */
  public readonly learningLiftRatio: prometheus.Gauge;
  /**
   * Cost-per-promoted-memory gauge (EPIC-212 Phase 3 Task 6):
   * analyst + embedding spend in the window divided by the
   * promoted count, in cents per memory. Set by the refresh pass;
   * `null` (no spend / no promoted memory) leaves the previous
   * value untouched and is reported only on the JSON snapshot.
   */
  public readonly learningCostPerPromotedMemory: prometheus.Gauge;
  /**
   * Per-window convergence score gauge (work item
   * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
   * AC-7).
   * The recorder's `promoted_to_bound_score` aggregate
   * (mean ratio across active scopes in the window),
   * labelled by `source` (`'24h' | '7d' | '30d'`) per the
   * canonical label key in
   * `ADR-learning-convergence-gauge-rename.md`.
   */
  public readonly learningConvergenceScore: prometheus.Gauge;
  /**
   * Memory-retention-policy recalibration counter (work item
   * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
   * AC-7).
   * Incremented on every recorder pass that called
   * `MemoryRetentionPolicyRepository.upsertIfChanged`,
   * labelled by `outcome` (`'applied' | 'no_change'`).
   * Canonical counter name
   * `nexus_memory_retention_recalibrations_total` (plural)
   * per `ADR-learning-convergence-gauge-rename.md`.
   */
  public readonly memoryRetentionRecalibrationsTotal: prometheus.Counter;
  public readonly memoryDecayEvaluatedTotal: prometheus.Counter;
  public readonly memoryDecayArchivedTotal: prometheus.Counter;
  public readonly workflowPostmortemRecordedTotal: prometheus.Counter;
  /**
   * Memory segments flagged as drifted by the nightly
   * `MemoryDriftDetectionService` (work item 0cead042-...ffb0).
   * Labels: `source` (closed enum `file`|`schema`|`api`) ×
   * `outcome` (closed enum `detected`|`exempt`|`unavailable`|`error`).
   */
  public readonly nexusMemoryDriftDetectedTotal: prometheus.Counter;

  // GitOps reconciliation metrics
  /**
   * GitOps reconciliation tick binding-evaluations (work item
   * WI-2026-059). `result` label is the per-binding terminal
   * state: `applied` | `conflict` | `error` (closed enum,
   * bounded cardinality).
   */
  public readonly gitopsReconciliationTickCompletedTotal: prometheus.Counter;

  /**
   * OAuth login sessions transitioned to `failed` by the
   * orphan-recovery path (work item b19758d8-...b4bc; follow-up §3
   * of `ADR-oauth-login-session-state-distribution.md`). Unlabelled
   * by design (single global series); per-provider breakdown is
   * deferred to an additive label change.
   */
  public readonly oauthLoginOrphanedTotal: prometheus.Counter;

  constructor() {
    this.registry = prometheus.register;

    // Registration stays in the constructor so `new MetricsService()`
    // (used by the spec file) sees fully populated metrics.
    const workflow = registerWorkflowInstruments();
    this.workflowExecutionDuration = workflow.executionDuration;
    this.workflowExecutionsTotal = workflow.executionsTotal;
    this.workflowsActive = workflow.active;

    const container = registerContainerInstruments();
    this.containerProvisioningDuration = container.provisioningDuration;
    this.containersActive = container.active;
    this.containerFailuresTotal = container.failuresTotal;

    const httpAcp = registerHttpAndAcpInstruments();
    this.httpRequestDuration = httpAcp.httpRequestDuration;
    this.httpRequestsTotal = httpAcp.httpRequestsTotal;
    this.acpServerDiscoveredAgents = httpAcp.acpServerDiscoveredAgents;
    this.acpInvokeDuration = httpAcp.acpInvokeDuration;
    this.acpInvokeTotal = httpAcp.acpInvokeTotal;

    const memory = registerMemoryInstruments();
    this.memoryBackendReadTotal = memory.backendReadTotal;
    this.memoryBackendWriteTotal = memory.backendWriteTotal;
    this.memoryBackendReadLatencyMs = memory.backendReadLatencyMs;
    this.memoryBackendActiveSegments = memory.backendActiveSegments;
    this.memoryBackendFallbackTotal = memory.backendFallbackTotal;
    this.distillationCompletedTotal = memory.distillationCompletedTotal;
    this.distillationCompressionRatio = memory.distillationCompressionRatio;
    this.learningPromotedTotal = memory.learningPromotedTotal;

    const [learningLessonInjectedTotal, learningRunOutcomeAfterLessonTotal] =
      registerLearningMetrics();
    this.learningLessonInjectedTotal = learningLessonInjectedTotal;
    this.learningRunOutcomeAfterLessonTotal =
      learningRunOutcomeAfterLessonTotal;

    this.learningLoopConvergenceRatio = registerLearningConvergenceGauge();

    const measurement = registerLearningMeasurementMetrics();
    this.learningBehaviourChangeTotal = measurement.behaviourChange;
    this.learningLiftRatio = measurement.lift;
    this.learningCostPerPromotedMemory = measurement.cost;

    const recorder = registerConvergenceRecorderMetrics();
    this.learningConvergenceScore = recorder.score;
    this.memoryRetentionRecalibrationsTotal = recorder.recalibration;

    const [
      memoryDecayEvaluatedTotal,
      memoryDecayArchivedTotal,
      workflowPostmortemRecordedTotal,
    ] = registerMemoryLifecycleMetrics();
    this.memoryDecayEvaluatedTotal = memoryDecayEvaluatedTotal;
    this.memoryDecayArchivedTotal = memoryDecayArchivedTotal;
    this.workflowPostmortemRecordedTotal = workflowPostmortemRecordedTotal;

    this.nexusMemoryDriftDetectedTotal = registerMemoryDriftMetric();

    this.gitopsReconciliationTickCompletedTotal =
      registerGitopsReconciliationTickCounter();

    this.oauthLoginOrphanedTotal = registerOAuthLoginOrphanedMetric();
  }

  // -------------------------------------------------------------------
  // Memory metrics mutators
  // -------------------------------------------------------------------

  recordMemoryBackendRead(backend: string, latencyMs: number): void {
    this.memoryBackendReadTotal.inc({ backend });
    this.memoryBackendReadLatencyMs.observe(
      { backend },
      Math.max(0, latencyMs),
    );
  }

  recordMemoryBackendWrite(backend: string, outcome: string): void {
    this.memoryBackendWriteTotal.inc({ backend, outcome });
  }

  setMemoryBackendActiveSegments(
    backend: string,
    source: string,
    count: number,
  ): void {
    this.memoryBackendActiveSegments.set(
      { backend, source },
      Math.max(0, Math.floor(count)),
    );
  }

  recordMemoryBackendFallback(
    from: string,
    to: string,
    operation: string,
  ): void {
    this.memoryBackendFallbackTotal.inc({ from, to, operation });
  }

  recordDistillationCompleted(outcome: string, compressionRatio: number): void {
    this.distillationCompletedTotal.inc({ outcome });
    if (Number.isFinite(compressionRatio)) {
      this.distillationCompressionRatio.observe(Math.max(0, compressionRatio));
    }
  }

  recordLearningPromoted(): void {
    this.learningPromotedTotal.inc();
  }

  /**
   * Record one promoted lesson injected into a downstream agent's
   * planning context (work item 88d7654e-...06db) — the "use" leg
   * of the self-improvement feedback loop. `lessonId` is the
   * promoted memory UUID; `scope` is the resolved entity id
   * (project / workflow run UUID). Both labels have bounded
   * cardinality by construction.
   */
  recordLearningLessonInjected(lessonId: string, scope: string): void {
    this.learningLessonInjectedTotal.inc({ lesson_id: lessonId, scope });
  }

  /**
   * Record one workflow-run terminal outcome observed after at
   * least one promoted lesson was injected into a planning step
   * during the run (work item 88d7654e-...06db milestone 2). Called
   * by `WorkflowRunOutcomeAfterLessonListener` once per
   * `(lesson_id, scope)` pair injected, on the terminal
   * `workflow.run.{completed,failed}` event. The label union
   * (`success`|`failure`) mirrors `WorkflowStatus.{COMPLETED,FAILED}`
   * — `CANCELLED` is intentionally excluded.
   */
  recordLearningRunOutcomeAfterLesson(
    lessonId: string,
    scope: string,
    outcome: 'success' | 'failure',
  ): void {
    this.learningRunOutcomeAfterLessonTotal.inc({
      lesson_id: lessonId,
      scope,
      outcome,
    });
  }

  /**
   * Set the convergence-ratio gauge for one `scope` (work item
   * 88d7654e-...06db milestone 3). Called by
   * `MemoryMetricsService.snapshot()`. The ratio is a finite
   * number in `[0, 1]`; out-of-range and non-finite values are
   * clamped so a single bad input cannot poison the scrape.
   */
  setLearningLoopConvergenceRatio(scope: string, ratio: number): void {
    let safe: number;
    if (typeof ratio !== 'number' || Number.isNaN(ratio)) {
      safe = 0;
    } else if (ratio === Number.POSITIVE_INFINITY) {
      safe = 1;
    } else if (ratio === Number.NEGATIVE_INFINITY) {
      safe = 0;
    } else if (ratio < 0) {
      safe = 0;
    } else if (ratio > 1) {
      safe = 1;
    } else {
      safe = ratio;
    }
    this.learningLoopConvergenceRatio.set({ scope }, safe);
  }

  /**
   * Record one behaviour-change observation (EPIC-212 Phase 3
   * Task 6). `scope` is the resolved entity id; `changed` is
   * whether the run exercised the lesson's anchored tool/path
   * after injection.
   */
  recordLearningBehaviourChange(scope: string, changed: boolean): void {
    this.learningBehaviourChangeTotal.inc({
      scope,
      changed: changed ? 'true' : 'false',
    });
  }

  /**
   * Set the A/B holdout lift gauge for one `scope` (EPIC-212
   * Phase 3 Task 6). Non-finite values are ignored so a bad input
   * cannot poison the scrape.
   */
  setLearningLiftRatio(scope: string, lift: number): void {
    if (typeof lift !== 'number' || !Number.isFinite(lift)) {
      return;
    }
    this.learningLiftRatio.set({ scope }, lift);
  }

  /**
   * Set the cost-per-promoted-memory gauge (EPIC-212 Phase 3
   * Task 6). Non-finite / negative values are ignored (the
   * refresh pass reports `null` on the JSON snapshot in that
   * case).
   */
  setLearningCostPerPromotedMemory(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return;
    }
    this.learningCostPerPromotedMemory.set(value);
  }

  /**
   * Set the per-window convergence score gauge (work item
   * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
   * AC-7). Called by
   * `ConvergenceRecorderService.recordRetentionRecalibrationIfChanged`
   * after the recorder computes the per-window
   * `promoted_to_bound_score` aggregate so the Prometheus
   * scrape mirrors the persisted `learning_measurement_snapshots`
   * row.
   *
   * `window` is the closed enum `'24h' | '7d' | '30d'`; an
   * unrecognised label is coerced to `'unknown'` so a bad
   * input cannot crash the scrape. The prom-client label KEY
   * the gauge is registered against is `source` per
   * `ADR-learning-convergence-gauge-rename.md` (canonical
   * contract) — the JS parameter name `window` is kept for
   * caller ergonomics but is mapped to the `source` label
   * when the prom-client `set` call fires. Non-finite /
   * out-of-range `score` values are clamped to `[0, 1]` so a
   * single bad input cannot poison the gauge.
   */
  setConvergenceScore(window: string, score: number): void {
    const safeWindow =
      window === '24h' || window === '7d' || window === '30d'
        ? window
        : 'unknown';
    let safeScore: number;
    if (typeof score !== 'number' || Number.isNaN(score)) {
      safeScore = 0;
    } else if (!Number.isFinite(score)) {
      safeScore = score > 0 ? 1 : 0;
    } else if (score < 0) {
      safeScore = 0;
    } else if (score > 1) {
      safeScore = 1;
    } else {
      safeScore = score;
    }
    this.learningConvergenceScore.set({ source: safeWindow }, safeScore);
  }

  /**
   * Increment the memory-retention-policy recalibration
   * counter (work item 946a3c8b-5814-4e76-a804-b557e589600b,
   * milestone 2, AC-7). Called by
   * `ConvergenceRecorderService.recordRetentionRecalibrationIfChanged`
   * once per recorder pass that called
   * `MemoryRetentionPolicyRepository.upsertIfChanged`.
   *
   * `outcome` is the closed enum `'applied' | 'no_change'` —
   * the literal value `MemoryRetentionPolicyUpsertOutcome`
   * from the repository types module. Unrecognised labels
   * are coerced to `'unknown'` so a bad input cannot crash
   * the scrape.
   */
  recordMemoryRetentionRecalibration(outcome: 'applied' | 'no_change'): void {
    const safeOutcome =
      outcome === 'applied' || outcome === 'no_change' ? outcome : 'unknown';
    this.memoryRetentionRecalibrationsTotal.inc({ outcome: safeOutcome });
  }

  recordMemoryDecayRun(evaluated: number, archived: number): void {
    if (Number.isFinite(evaluated) && evaluated > 0) {
      this.memoryDecayEvaluatedTotal.inc(Math.floor(evaluated));
    }
    if (Number.isFinite(archived) && archived > 0) {
      this.memoryDecayArchivedTotal.inc(Math.floor(archived));
    }
  }

  /**
   * Increment the memory-drift counter for one per-row outcome
   * (work item 0cead042-...ffb0). `source` is the parser's
   * `referenceKind` (closed enum `file`|`schema`|`api`); the
   * mutator is defensive about label safety — a non-finite /
   * non-string `source` value is coerced to `'unknown'` so the
   * Prometheus scrape cannot fail on a malformed input.
   */
  recordMemoryDriftDetected(params: {
    source: string;
    outcome: 'detected' | 'exempt' | 'unavailable' | 'error';
  }): void {
    const source = normaliseDriftMetricLabel(params.source);
    const outcome = params.outcome;
    this.nexusMemoryDriftDetectedTotal.inc({ source, outcome });
  }

  /**
   * Increment the postmortem-writeback counter for one outcome
   * (work item 5743ac93-...318da). Mirrors `recordMemoryBackendWrite`:
   * the listener (milestone 2) calls this once per processed
   * `WORKFLOW_RUN_FAILED_EVENT`. The label union
   * (`success`|`skipped`|`failed`) is intentionally inlined here
   * (rather than imported from the constants module) to keep the
   * metrics service free of workflow-repair module dependencies.
   */
  recordWorkflowPostmortemRecorded(
    outcome: 'success' | 'skipped' | 'failed',
  ): void {
    this.workflowPostmortemRecordedTotal.inc({ outcome });
  }

  /**
   * Increment the orphan-recovery counter by one (work item
   * b19758d8-...b4bc; follow-up §3 of
   * `ADR-oauth-login-session-state-distribution.md`). Called by
   * `OAuthInstrumentation.recordOAuthLoginOrphaned` exactly once
   * per orphan-recovery transition in `oauth-login.service.ts`.
   * The increment must NOT fire on the success, provider-side
   * failure, manual-code, or expired-session sibling code paths.
   * Non-throwing guarantee lives in `OAuthInstrumentation` (which
   * wraps this mutator in `try { ... } catch { swallow }`).
   */
  recordOAuthLoginOrphaned(): void {
    this.oauthLoginOrphanedTotal.inc();
  }

  onModuleInit() {
    prometheus.collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
