import * as prometheus from 'prom-client';

/**
 * Learning-self-improvement feedback-loop instruments
 * (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db).
 *
 * This file is split into THREE factory functions that mirror
 * the three private methods on the original `MetricsService`:
 *   - `registerLearningMetrics()` — the lesson-injection and
 *     post-injection outcome counters (the two counters that
 *     close the feedback loop).
 *   - `registerLearningConvergenceGauge()` — the convergence
 *     ratio gauge, computed by `MemoryMetricsService.snapshot()`.
 *   - `registerLearningMeasurementMetrics()` — the EPIC-212
 *     Phase 3 Task 6 causal-measurement instruments
 *     (behaviour-change counter, holdout-lift gauge,
 *     cost-per-promoted-memory gauge).
 *
 * All factories register against the global `prom-client`
 * registry. Bodies are faithful verbatim extractions of the
 * original `MetricsService` private methods so metric names,
 * label names, help strings, and types remain byte-identical to
 * the previous in-class definition.
 *
 * Note on the return shape of `registerLearningMetrics()`: the
 * tuple is `[Counter, Counter]` (lesson-injection counter,
 * post-injection outcome counter) — matching the original
 * `MetricsService.registerLearningMetrics()` body exactly.
 * The behaviour-change counter, holdout-lift gauge, and
 * cost-per-promoted-memory gauge live on
 * `registerLearningMeasurementMetrics()` instead — they are
 * EPIC-212 Phase 3 Task 6 measurement instruments, not part
 * of the milestone-2 feedback-loop counters.
 */

/**
 * Register the lesson-injection counter and the
 * post-injection outcome counter. Returned as a 2-tuple so
 * the caller can assign them to the matching readonly
 * fields on `MetricsService`.
 */
export function registerLearningMetrics(): readonly [
  prometheus.Counter,
  prometheus.Counter,
] {
  const learningLessonInjected = new prometheus.Counter({
    name: 'nexus_learning_lesson_injected_total',
    help: 'Total number of promoted learning lessons injected into an agent planning context (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db)',
    labelNames: ['lesson_id', 'scope'],
  });

  const learningRunOutcomeAfterLesson = new prometheus.Counter({
    name: 'nexus_workflow_run_outcome_after_lesson_total',
    help: 'Total number of workflow-run terminal outcomes observed after at least one promoted learning lesson was injected into a planning step during the run (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2). Labelled by lesson_id, scope, and outcome (success|failure).',
    labelNames: ['lesson_id', 'scope', 'outcome'],
  });

  return [learningLessonInjected, learningRunOutcomeAfterLesson] as const;
}

/**
 * Register the learning-loop convergence-ratio gauge (work
 * item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3).
 * The ratio is `success_outcome_count / total_outcome_count`
 * over a rolling window of `learning_convergence_window_days`
 * days; computed at `MemoryMetricsService.snapshot()` time
 * and pushed into this gauge for the Prometheus scrape.
 */
export function registerLearningConvergenceGauge(): prometheus.Gauge {
  return new prometheus.Gauge({
    name: 'nexus_learning_loop_convergence_ratio',
    help: 'Convergence ratio of the learning self-improvement feedback loop (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3): success_outcome_count / total_outcome_count over a rolling window of learning_convergence_window_days days. 0 when no runs-after-lesson have been observed in the window; 1 when every observed run-after-lesson terminated successfully.',
    labelNames: ['scope'],
  });
}

/**
 * Register the EPIC-212 Phase 3 Task 6 causal-measurement
 * instruments (behaviour-change counter, holdout-lift gauge,
 * cost-per-promoted-memory gauge).
 */
export function registerLearningMeasurementMetrics(): {
  behaviourChange: prometheus.Counter;
  lift: prometheus.Gauge;
  cost: prometheus.Gauge;
} {
  const behaviourChange = new prometheus.Counter({
    name: 'nexus_learning_behaviour_change_total',
    help: 'Post-injection behaviour-change observations (EPIC-212 Phase 3 Task 6): for lessons carrying a behaviour-change anchor, whether the run exercised the anchored tool/path after injection. Labelled by scope and changed (true|false).',
    labelNames: ['scope', 'changed'],
  });
  const lift = new prometheus.Gauge({
    name: 'nexus_learning_lift',
    help: 'A/B holdout lift (EPIC-212 Phase 3 Task 6): convergence(injected_arm) − convergence(holdout_arm) per scope. Only set when the holdout arm has in-window runs (learning_holdout_fraction > 0).',
    labelNames: ['scope'],
  });
  const cost = new prometheus.Gauge({
    name: 'nexus_learning_cost_per_promoted_memory',
    help: 'Cost-per-promoted-memory (EPIC-212 Phase 3 Task 6): analyst + embedding spend in the window divided by the promoted count, in cents per memory. Computed by the metrics refresh pass.',
  });
  return { behaviourChange, lift, cost };
}

/**
 * Register the daily convergence recorder instruments (work
 * item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
 * AC-7). Returns the recorder's score gauge and recalibration
 * counter so the caller can wire them onto
 * `MetricsService`.
 *
 * The canonical metric names + label keys are pinned by
 * `docs/architecture/decisions/ADR-learning-convergence-gauge-rename.md`:
 *
 *   - `score` is the per-window
 *     `nexus_learning_convergence_score{source}` gauge the
 *     recorder sets after computing the
 *     `promoted_to_bound_score` aggregate. Labelled by the
 *     closed enum `source` (`'24h' | '7d' | '30d'`) so the
 *     ADR's canonical label key matches the spec contract.
 *   - `recalibration` is the labelled
 *     `nexus_memory_retention_recalibrations_total{outcome}`
 *     counter (note the plural `recalibrations`, matching
 *     the ADR canonical contract) the recorder increments
 *     on every
 *     `MemoryRetentionPolicyRepository.upsertIfChanged` call
 *     — labelled by `outcome` so the operator can distinguish
 *     `applied` from `no_change` calls in the scrape.
 */
export function registerConvergenceRecorderMetrics(): {
  score: prometheus.Gauge;
  recalibration: prometheus.Counter;
} {
  const score = new prometheus.Gauge({
    name: 'nexus_learning_convergence_score',
    help: "Per-window convergence score (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2, AC-7): the recorder's `promoted_to_bound_score` aggregate (mean ratio across active scopes in the window). Labelled by source ('24h' | '7d' | '30d') — canonical label key per `ADR-learning-convergence-gauge-rename.md`.",
    labelNames: ['source'],
  });
  const recalibration = new prometheus.Counter({
    name: 'nexus_memory_retention_recalibrations_total',
    help: "Memory-retention-policy recalibration counter (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2, AC-7). Canonical counter name `nexus_memory_retention_recalibrations_total` (plural) per `ADR-learning-convergence-gauge-rename.md`. Incremented on every MemoryRetentionPolicyRepository.upsertIfChanged call; labelled by outcome ('applied' | 'no_change').",
    labelNames: ['outcome'],
  });
  return { score, recalibration };
}
