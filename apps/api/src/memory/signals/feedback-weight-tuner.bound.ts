import type {
  BoundedWeights,
  ScoringWeightVector,
} from './feedback-weight-tuner.types';

export type {
  BoundedWeights,
  ScoringWeightVector,
} from './feedback-weight-tuner.types';

/** The five tunable scoring-weight fields, in a stable iteration order. */
const WEIGHT_KEYS: ReadonlyArray<keyof ScoringWeightVector> = [
  'w_recurrence',
  'w_source_quality',
  'w_recency',
  'w_diversity',
  'beta',
];

/** Clamp `value` into the closed interval `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Bound a freshly-trained weight vector so no single weight moves more than
 * `maxDelta` away from the corresponding current weight in one run. This is
 * the safety clamp that makes a weekly retune incremental and reversible: a
 * noisy retrain can nudge a weight at most `maxDelta` per pass, so a bad pass
 * is recoverable by a single revert (re-applying the prior weights) rather
 * than an unbounded swing.
 *
 * Pure and total — `maxDelta` is assumed non-negative (the caller coerces it
 * via `coerceFeedbackWeightTunerMaxDelta`). Returns the clamped vector plus
 * `boundedDelta`, the magnitude of the largest change actually applied
 * (`max_k |bounded_k − current_k|`), which the caller persists onto the
 * history row.
 *
 * @param proposed The newly-trained weights.
 * @param current The current (live) scoring weights.
 * @param maxDelta Per-weight clamp radius.
 */
export function boundWeights(
  proposed: ScoringWeightVector,
  current: ScoringWeightVector,
  maxDelta: number,
): BoundedWeights {
  const bounded: Record<keyof ScoringWeightVector, number> = {
    w_recurrence: 0,
    w_source_quality: 0,
    w_recency: 0,
    w_diversity: 0,
    beta: 0,
  };

  let boundedDelta = 0;

  for (const key of WEIGHT_KEYS) {
    const lower = current[key] - maxDelta;
    const upper = current[key] + maxDelta;
    const clamped = clamp(proposed[key], lower, upper);
    bounded[key] = clamped;

    const appliedDelta = Math.abs(clamped - current[key]);
    if (appliedDelta > boundedDelta) {
      boundedDelta = appliedDelta;
    }
  }

  return { bounded, boundedDelta };
}
