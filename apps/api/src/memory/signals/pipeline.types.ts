/**
 * Shared types for the clusterer/scoring/routing pipeline in
 * `MemorySignalsModule`.
 *
 * Split into a dedicated file to satisfy the `no-restricted-syntax`
 * project lint rule that requires exported interfaces to live in
 * `*.types.ts` files.
 */

import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { ClusterResult } from './candidate-clusterer.types';
import type { ScoringPassResult } from './candidate-scoring.types';

/**
 * Value-object shape consumed by the cluster/score/route pipeline.
 *
 * `SignalCandidate` is a *structural subset* of {@link LearningCandidate}
 * that lists only the fields the in-process pipeline reads:
 *
 * - `id` — the primary key, used for clustering, ranking, and update fan-out
 * - `status` — pipeline gate; only `'pending'` rows are processed
 * - `candidate_type` — drives `source_quality_confidence` prior lookup
 * - `title` — surfaced for templated/noise classification
 * - `summary` — embedding corpus and lexical fallback similarity input
 * - `first_seen_at` — recency-decay anchor (`exp(-λ · Δdays)`)
 * - `recurrence_count` — set by the clusterer, read by the scorer (clusterer-owned)
 * - `source_quality_confidence` — set/read by the scorer
 * - `score` — composite logistic output of the scorer; consumed by routing
 * - `signals_json` — per-signal breakdown persisted by the scorer
 * - `stage_diversity_count` — normalized against the diversity cap
 * - `routing_target` — output of routing, input to the sweep/promotion path
 *
 * **`StruggleDetectorService` is intentionally scoped OUT** of this contract.
 * Struggle detection **writes** new candidate rows via `RecordLearningService`
 * rather than mutating existing pipeline candidates, so its lifecycle (a
 * per-run event listener that emits evidence-backed rows) does not match the
 * shared "load → cluster → score → route" pipeline shape. A future
 * contributor tempted to fold `StruggleDetectorService` into the pipeline
 * should resist: the two flows have different triggers (workflow run
 * completion vs. nightly sweep), different cost profiles (event-stream scan
 * vs. low-volume row pass), and different write shapes (new-candidate
 * injection vs. status/score updates on existing rows). See
 * `struggle-detector.service.ts` for the writer-side contract.
 *
 * Type assignment: any {@link LearningCandidate} row is assignable to a
 * `SignalCandidate` slot because every required field is a structural
 * subset. Pipeline helpers may therefore accept `SignalCandidate` and
 * still be called with a full `LearningCandidate` (or any larger row
 * shape) without conversion.
 */
export interface SignalCandidate {
  id: string;
  status: string;
  candidate_type: string;
  title: string;
  summary: string;
  first_seen_at: Date;
  recurrence_count: number;
  source_quality_confidence: number;
  score: number;
  signals_json: Record<string, unknown>;
  stage_diversity_count: number;
  routing_target: string | null;
}

/**
 * Compile-time assertion that {@link LearningCandidate} is assignable to
 * `SignalCandidate` — i.e. that `SignalCandidate` truly is a structural
 * subset of `LearningCandidate` for the fields the pipeline reads.
 *
 * If a future change to {@link LearningCandidate} renames or removes one
 * of the `SignalCandidate` fields, this function will fail to typecheck
 * (the parameter `c` no longer satisfies the return type) and the
 * maintainer will know to update both the contract and the pipeline
 * helpers in lockstep.
 */
function _assertLearningCandidateAssignsToSignalCandidate(
  c: LearningCandidate,
): SignalCandidate {
  return c;
}

/**
 * Aggregated result returned by `CandidatePipelineService.run()`.
 *
 * Mirrors the three orchestrated steps:
 * - `cluster` — the {@link ClusterResult} returned by
 *   `CandidateClustererService.cluster()`.
 * - `scoring` — the {@link ScoringPassResult} returned by
 *   `CandidateScoringService.scoreAll()`. On a fail-soft scoring error
 *   the pipeline still returns a `PipelineRunResult` with `scoring`
 *   defaulted to `{ scored: 0, totalPending: 0 }` so callers downstream
 *   can render a non-zero `routed` count without a defensive null check.
 * - `routed` — the count of candidates whose `routing_target` was
 *   successfully persisted by the routing loop. Excludes any candidate
 *   that threw during routing or persistence (those were logged at
 *   `warn` and skipped — see `CandidatePipelineService` for the
 *   per-candidate fail-soft contract).
 */
export interface PipelineRunResult {
  cluster: ClusterResult;
  scoring: ScoringPassResult;
  routed: number;
}
