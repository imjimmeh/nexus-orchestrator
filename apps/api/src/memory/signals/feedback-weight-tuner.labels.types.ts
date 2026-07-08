/**
 * Exported interfaces for the pure label-derivation + feature-extraction
 * helpers (`feedback-weight-tuner.labels.ts`). Kept in a `*.types.ts` file per
 * the `no-restricted-syntax` rule.
 */

/**
 * The per-segment evidence the label derivation consumes. All fields are
 * already-resolved primitives so the derivation stays pure (no I/O).
 */
export interface SegmentLabelEvidence {
  /** `true` when the promoted segment was archived (auto-reverted). */
  readonly archived: boolean;
  /** `true` when the segment was superseded/contradicted by a newer one. */
  readonly superseded: boolean;
  /** Rolling-window usefulness ratio, or `null` when there are no votes yet. */
  readonly usefulness: number | null;
  /** Number of usefulness votes in the window. */
  readonly sampleSize: number;
}

/** Thresholds that gate when usefulness is allowed to drive a label. */
export interface LabelThresholds {
  /** Usefulness ratio at/above which a voted segment counts as positive. */
  readonly usefulnessThreshold: number;
  /** Minimum votes before usefulness can drive a positive/negative label. */
  readonly minVotes: number;
}

/**
 * The candidate-scoring feature axes the tuner trains over — exactly the
 * inputs `CandidateScoringService.computeScore` consumes, before the
 * log/normalisation transforms are applied.
 */
export interface CandidateFeatureInput {
  readonly recurrence_count: number;
  readonly source_quality_confidence: number;
  readonly recency_decay: number;
  readonly stage_diversity_count: number;
}
