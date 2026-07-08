import type { MemorySegmentType } from "./chat-sessions.types";

export interface MemoryExplorerSegment {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  memory_type: MemorySegmentType;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ListMemorySegmentsRequest {
  entity_id?: string;
  memory_type?: MemorySegmentType;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryExplorerSegmentListResponse {
  items: MemoryExplorerSegment[];
  total: number;
  limit: number;
  offset: number;
}

export type ChatMemorySource = "session" | "profile";

export interface ChatMemoryExplorerSegment {
  id: string;
  source: ChatMemorySource;
  profile_id: string;
  chat_session_id: string | null;
  memory_type: MemorySegmentType;
  content: string;
  confidence_score: number | null;
  importance_score: number | null;
  distilled_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListChatMemorySegmentsRequest {
  source?: ChatMemorySource;
  profile_id?: string;
  chat_session_id?: string;
  memory_type?: MemorySegmentType;
  query?: string;
  include_archived?: boolean;
  only_undistilled?: boolean;
  limit?: number;
  offset?: number;
}

export interface ChatMemoryExplorerSegmentListResponse {
  source: ChatMemorySource;
  items: ChatMemoryExplorerSegment[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChatMemoryObservabilityResponse {
  counts: {
    jobs: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    events: {
      promoted: number;
      updated: number;
    };
  };
  recent_failed_jobs: Array<{
    id: string;
    job_type: "distill_session" | "consolidate_profile";
    trigger_reason: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    updated_at: string;
  }>;
  recent_events: Array<{
    id: string;
    event_type: string;
    action: string;
    chat_session_id: string;
    profile_id: string | null;
    created_at: string;
  }>;
}

/**
 * Per-backend memory observability snapshot.
 *
 * Mirrors `MemoryMetricsSnapshot` in `apps/api/src/memory/memory-metrics.types.ts`.
 * The web app does not depend on the api package, so the type is duplicated
 * verbatim. Keep both files in sync when the snapshot shape evolves.
 */
export type MemoryMetricsBackendLabel = "postgres" | "honcho";

export type MemoryMetricsWriteOutcome = "success" | "failure";

export type MemoryMetricsDistillationOutcome = "success" | "failure";

export interface MemoryMetricsLatencySummary {
  count: number;
  sum: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

export interface MemoryMetricsReadMetrics {
  total: Record<MemoryMetricsBackendLabel, number>;
  latency_ms: Record<MemoryMetricsBackendLabel, MemoryMetricsLatencySummary>;
}

export interface MemoryMetricsWriteMetrics {
  total: Record<
    MemoryMetricsBackendLabel,
    Record<MemoryMetricsWriteOutcome, number>
  >;
}

export interface MemoryMetricsActiveSegmentsMetrics {
  total: Record<MemoryMetricsBackendLabel, Record<string, number>>;
}

export interface MemoryMetricsBackendMetrics {
  read: MemoryMetricsReadMetrics;
  write: MemoryMetricsWriteMetrics;
  active_segments: MemoryMetricsActiveSegmentsMetrics;
  fallback: Record<string, number>;
}

export interface MemoryMetricsDistillationLastRun {
  input_segment_count: number;
  output_segment_count: number;
  compression_ratio: number;
  tokens_before: number;
  tokens_after: number;
  model: string;
  duration_ms: number;
  completed_at: string;
}

export interface MemoryMetricsDistillationMetrics {
  completed_total: Record<MemoryMetricsDistillationOutcome, number>;
  last: MemoryMetricsDistillationLastRun | null;
}

export interface MemoryMetricsLearningLastPromoted {
  candidate_id: string;
  confidence: number;
  scope: string;
  source_decision_id: string;
  promoted_at: string;
}

/**
 * Last-write snapshot for a promoted learning lesson that was
 * actually injected into an agent planning context (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db). Mirrors the backend
 * `LearningLastLessonInjected` shape in
 * `apps/api/src/memory/memory-metrics.types.ts`.
 */
export interface MemoryMetricsLearningLastLessonInjected {
  lesson_id: string;
  scope: string;
  injected_at: string;
}

/**
 * Last-write snapshot for a workflow-run terminal outcome
 * observed after at least one promoted learning lesson was
 * injected into a planning step during that run (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 2). Mirrors
 * the backend `LearningLastRunOutcomeAfterLesson` shape.
 */
export interface MemoryMetricsLearningLastRunOutcomeAfterLesson {
  lesson_id: string;
  scope: string;
  outcome: "success" | "failure";
  observed_at: string;
}

/**
 * Per-scope convergence snapshot (work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3). Mirrors
 * the backend `LearningConvergenceSnapshot` shape.
 *
 * `ratio` is `successes_after_lesson / runs_after_lesson` over
 * a rolling window of `window_days` days. The block is omitted
 * entirely from `learning.convergence` when the scope has zero
 * injections AND zero outcomes in the window — an empty map
 * is the "no data" signal.
 */
export interface MemoryMetricsLearningConvergenceSnapshot {
  ratio: number;
  window_days: number;
  runs_after_lesson: number;
  successes_after_lesson: number;
  computed_at: string;
}

/**
 * Per-arm run tally exposed alongside the holdout lift snapshot.
 * Mirrors the backend `LearningLiftArmSnapshot` shape.
 */
export interface MemoryMetricsLearningLiftArmSnapshot {
  ratio: number;
  runs: number;
  successes: number;
}

/**
 * Per-scope A/B holdout lift snapshot (EPIC-212 Phase 3, Task 6).
 * Mirrors the backend `LearningLiftSnapshot` shape.
 *
 * `lift = convergence(injected_arm) − convergence(holdout_arm)`, or `null`
 * when the holdout arm has no in-window runs (the default state when
 * `learning_holdout_fraction = 0`, so the loop's behaviour is unchanged).
 */
export interface MemoryMetricsLearningLiftSnapshot {
  lift: number | null;
  injected: MemoryMetricsLearningLiftArmSnapshot;
  holdout: MemoryMetricsLearningLiftArmSnapshot;
  window_days: number;
  computed_at: string;
}

/**
 * Last-write snapshot for the behaviour-change counter. Mirrors the backend
 * `LearningLastBehaviourChange` shape.
 */
export interface MemoryMetricsLearningLastBehaviourChange {
  lesson_id: string;
  scope: string;
  changed: boolean;
  observed_at: string;
}

/**
 * Behaviour-change counter snapshot (EPIC-212 Phase 3, Task 6). Mirrors the
 * backend `LearningBehaviourChangeMetrics` shape. Counts, for lessons that
 * carried a behaviour-change anchor, whether the run actually exercised the
 * anchored tool/path after injection.
 */
export interface MemoryMetricsLearningBehaviourChange {
  changed_total: number;
  unchanged_total: number;
  last: MemoryMetricsLearningLastBehaviourChange | null;
}

/**
 * Last-pass snapshot for the probation evaluator. Mirrors the backend
 * `LearningLastProbationPass` shape.
 */
export interface MemoryMetricsLearningLastProbationPass {
  confirmed: number;
  reverted: number;
  held: number;
  observed_at: string;
}

/**
 * Provisional-memory probation evaluator rollup (EPIC-212 Phase 3, Task 7).
 * Mirrors the backend `LearningProbationMetrics` shape. All zero / `null`
 * until the evaluator runs (default-OFF leaves it inert).
 */
export interface MemoryMetricsLearningProbation {
  confirmed_total: number;
  reverted_total: number;
  held_total: number;
  last_pass: MemoryMetricsLearningLastProbationPass | null;
}

export interface MemoryMetricsLearningMetrics {
  promoted_total: number;
  last_promoted: MemoryMetricsLearningLastPromoted | null;
  lesson_injected_total: number;
  last_lesson_injected: MemoryMetricsLearningLastLessonInjected | null;
  run_outcome_after_lesson_total: number;
  last_run_outcome_after_lesson: MemoryMetricsLearningLastRunOutcomeAfterLesson | null;
  convergence: Record<string, MemoryMetricsLearningConvergenceSnapshot>;
  /**
   * Behaviour-change counter (EPIC-212 Phase 3, Task 6). Optional so an older
   * backend payload (without the Phase-3 measurement block) still type-checks
   * and the Learning Health panel degrades gracefully.
   */
  behaviour_change?: MemoryMetricsLearningBehaviourChange;
  /**
   * Per-scope A/B holdout lift (EPIC-212 Phase 3, Task 6). Empty `{}` when no
   * holdout arm has been measured (`learning_holdout_fraction = 0`); each
   * present entry carries `lift = injected − holdout` (or `null` when that
   * scope's holdout arm is empty in the window). Optional for backward compat.
   */
  lift?: Record<string, MemoryMetricsLearningLiftSnapshot>;
  /**
   * Cost-per-promoted-memory in cents (EPIC-212 Phase 3, Task 6). `null` when
   * there is no spend or no promoted memory in the window. Optional for
   * backward compat.
   */
  cost_per_promoted_memory?: number | null;
  /**
   * Suppressed-noise rollup (EPIC-212 Phase 3, Task 6): the count of learning
   * candidates the dedup/template sweep merged away. `null` when not
   * available. Optional for backward compat.
   */
  suppressed_noise_count?: number | null;
  /**
   * Provisional-memory probation evaluator rollup (EPIC-212 Phase 3, Task 7).
   * Optional for backward compat.
   */
  probation?: MemoryMetricsLearningProbation;
}

export interface MemoryMetricsResponse {
  backend: MemoryMetricsBackendMetrics;
  distillation: MemoryMetricsDistillationMetrics;
  learning: MemoryMetricsLearningMetrics;
  generated_at: string;
}
