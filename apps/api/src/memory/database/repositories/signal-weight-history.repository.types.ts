import type { ScoringWeightVector } from '../../signals/feedback-weight-tuner.types';

/**
 * Input shape for {@link SignalWeightHistoryRepository.create}. Decoupled from
 * the entity so callers supply only the fields a new history row needs; `id`
 * and `created_at` are server-assigned.
 */
export interface CreateSignalWeightHistoryInput {
  /** The new (bounded) scoring-weight vector this pass produced. */
  weights_json: ScoringWeightVector;
  /** The live weights it replaced (re-applied verbatim on revert). */
  previous_weights_json: ScoringWeightVector | null;
  /** Number of labelled samples the retrain saw. */
  training_sample_size: number;
  /** Largest applied clamp delta. */
  bounded_delta: number | null;
  /** Whether the new weights were persisted to the live settings. */
  applied: boolean;
  /** Short machine-readable reason. */
  reason: string | null;
}
