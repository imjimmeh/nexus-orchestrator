/**
 * Public types for {@link CandidateScoringService}.
 *
 * Split into a dedicated file to satisfy the `no-restricted-syntax`
 * project lint rule that requires exported interfaces to live in
 * `*.types.ts` files.
 */

/** Per-signal breakdown returned by `scoreOne` and stored in `signals_json`. */
export interface CandidateScoringResult {
  score: number;
  source_quality_confidence: number;
  recency_decay: number;
  stage_diversity_count: number;
  signals_json: Record<string, unknown>;
}

/** Summary returned by `scoreAll`. */
export interface ScoringPassResult {
  scored: number;
  totalPending: number;
}
