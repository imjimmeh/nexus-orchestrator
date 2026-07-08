import type {
  CandidateFeatureInput,
  LabelThresholds,
  SegmentLabelEvidence,
} from './feedback-weight-tuner.labels.types';

export type {
  CandidateFeatureInput,
  LabelThresholds,
  SegmentLabelEvidence,
} from './feedback-weight-tuner.labels.types';

/**
 * Derive a binary training label for a promoted candidate from its segment's
 * downstream evidence. Pure and total.
 *
 * **Label policy (documented contract):**
 *   - **Negative (`0`)** — the auto-promotion went bad: the segment was
 *     archived (auto-reverted by the probation evaluator), OR superseded
 *     (contradicted by a newer memory), OR earned a low usefulness ratio
 *     (`usefulness < usefulnessThreshold`) over at least `minVotes` votes.
 *     Revert/contradiction take precedence over any usefulness reading.
 *   - **Positive (`1`)** — the auto-promotion proved good: the segment is
 *     still live (not archived, not superseded) AND earned a high usefulness
 *     ratio (`usefulness >= usefulnessThreshold`) over at least `minVotes`
 *     votes.
 *   - **`null` (unlabelled, excluded from training)** — there is not yet
 *     enough signal to label: a live segment with no votes (or fewer than
 *     `minVotes`). A never-voted lesson is never used as a training row, so
 *     the tuner only learns from outcomes it can actually attribute.
 */
export function deriveCandidateLabel(
  evidence: SegmentLabelEvidence,
  thresholds: LabelThresholds,
): number | null {
  if (evidence.archived || evidence.superseded) {
    return 0;
  }

  const hasEnoughVotes =
    evidence.usefulness !== null && evidence.sampleSize >= thresholds.minVotes;

  if (!hasEnoughVotes) {
    return null;
  }

  return evidence.usefulness !== null &&
    evidence.usefulness >= thresholds.usefulnessThreshold
    ? 1
    : 0;
}

/**
 * Extract the candidate-scoring feature vector in the exact order the scoring
 * weights are applied by `CandidateScoringService.computeScore`:
 *
 * ```
 * [ log(recurrence_count), source_quality_confidence,
 *   recency_decay, min(stage_diversity_count, cap) / cap ]
 * ```
 *
 * Mirroring the scoring transforms keeps the trained weights on the same scale
 * as the hand-set priors they replace, so a bounded retune is a like-for-like
 * adjustment. `recurrence_count` is floored at 1 so `log()` never returns
 * `-Infinity`; the diversity norm is clamped to `[0, 1]`.
 */
export function extractCandidateFeatures(
  candidate: CandidateFeatureInput,
  diversityCap: number,
): number[] {
  const safeCap = diversityCap > 0 ? diversityCap : 1;
  const diversityNorm =
    Math.min(candidate.stage_diversity_count, safeCap) / safeCap;

  return [
    Math.log(Math.max(1, candidate.recurrence_count)),
    candidate.source_quality_confidence,
    candidate.recency_decay,
    diversityNorm,
  ];
}
