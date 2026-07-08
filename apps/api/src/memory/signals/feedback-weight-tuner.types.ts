/**
 * Exported interfaces shared by the weight-tuner service, bounder, and
 * history persistence (EPIC-212 Phase-3 Task 9). Kept in a dedicated
 * `*.types.ts` file to honour the `no-restricted-syntax` rule banning
 * exported interfaces from non-`.types.ts` modules.
 */

/**
 * The five logistic-regression parameters of the candidate-scoring formula —
 * the exact set the tuner retrains. The four `w_*` fields map to the
 * `candidate_scoring_w_*` settings; `beta` maps to the `candidate_scoring_beta`
 * intercept. Serialised verbatim into `signal_weight_history.weights_json` /
 * `previous_weights_json`.
 */
export interface ScoringWeightVector {
  readonly w_recurrence: number;
  readonly w_source_quality: number;
  readonly w_recency: number;
  readonly w_diversity: number;
  readonly beta: number;
}

/** Outcome of a single bounding pass. */
export interface BoundedWeights {
  /** The new weights after per-field clamping to within `maxDelta`. */
  readonly bounded: ScoringWeightVector;
  /**
   * The magnitude of the largest weight change actually applied
   * (`max_k |bounded_k − current_k|`). Persisted as
   * `signal_weight_history.bounded_delta`.
   */
  readonly boundedDelta: number;
}

/** Why a tuner pass did (or did not) apply a retune. */
export type WeightTuneReason =
  | 'disabled'
  | 'insufficient_samples'
  | 'retuned'
  | 'error';

/** Result of one weekly tuner pass. */
export interface WeightTuneOutcome {
  /** `true` when the new weights were persisted to the scoring settings. */
  readonly applied: boolean;
  /** Machine-readable reason for the outcome. */
  readonly reason: WeightTuneReason;
  /** Number of labelled samples the retrain was computed over. */
  readonly sampleSize: number;
  /** Largest applied weight change (0 when nothing was applied). */
  readonly boundedDelta: number;
  /** Id of the `signal_weight_history` row written, when one was written. */
  readonly historyId?: string;
}
