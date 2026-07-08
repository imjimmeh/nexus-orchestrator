/**
 * Pure provisional-memory probation decision (EPIC-212 Phase-3 Task 7).
 *
 * Mirrors the `decideMemoryRetentionKeep` separation in
 * `memory-decay.value-predicate.ts`: all decision logic is pure and I/O-free
 * so the full verdict matrix is exhaustively unit-testable and reused by the
 * `MemoryProbationEvaluatorService` without touching a database.
 *
 * Precedence (documented + exhaustively unit-tested):
 *   1. INSIDE probation (`probationUntilMs > nowMs`) ⇒ `hold`. Both confirm
 *      and revert require the probation window to have elapsed.
 *   2. HARD revert signals — `contradicted` (superseded), `drifted`, or
 *      `unused` (`accessCount === 0`) — ⇒ `revert`. They win even with
 *      few/zero votes and even over a usefulness/injected confirm: a
 *      superseded, drifted, or never-used auto-promotion is bad regardless
 *      of its vote tally.
 *   3. CONFIRM — past probation AND (`injectedAndHelped` OR enough useful
 *      votes: `usefulness >= confirmThreshold` with `sampleSize >= minSamples`).
 *   4. LOW-USEFULNESS revert — enough votes but `usefulness < confirmThreshold`.
 *   5. Otherwise (insufficient votes, no hard signal, not confirmed) ⇒ `hold`.
 *
 * The function is total and never throws; out-of-band numeric inputs are
 * compared as-is (the caller coerces thresholds).
 */

import type {
  ProbationInput,
  ProbationThresholds,
  ProbationVerdict,
} from './memory-probation.decide.types';

export type {
  ProbationInput,
  ProbationThresholds,
  ProbationVerdict,
} from './memory-probation.decide.types';

/** Reason codes surfaced on a {@link ProbationVerdict}. */
export const PROBATION_REASONS = {
  insideProbation: 'inside_probation',
  contradicted: 'contradicted',
  drifted: 'drifted',
  unused: 'unused',
  injectedAndHelped: 'injected_and_helped',
  useful: 'useful',
  lowUsefulness: 'low_usefulness',
  insufficientVotes: 'insufficient_votes',
} as const;

/** Decide the probation verdict for a single provisional segment. */
export function decideProbation(
  input: ProbationInput,
  thresholds: ProbationThresholds,
  nowMs: number,
): ProbationVerdict {
  const verdict = (
    action: ProbationVerdict['action'],
    reason: string,
  ): ProbationVerdict => ({
    segmentId: input.segmentId,
    action,
    reason,
    usefulness: input.usefulness,
    sampleSize: input.sampleSize,
  });

  // 1. Inside probation → hold (confirm and revert both require past-probation).
  if (input.probationUntilMs !== null && input.probationUntilMs > nowMs) {
    return verdict('hold', PROBATION_REASONS.insideProbation);
  }

  // 2. Hard revert signals win even with few votes and over confirm.
  if (input.contradicted) {
    return verdict('revert', PROBATION_REASONS.contradicted);
  }
  if (input.drifted) {
    return verdict('revert', PROBATION_REASONS.drifted);
  }
  if (input.accessCount === 0) {
    return verdict('revert', PROBATION_REASONS.unused);
  }

  // 3. Confirm: injected-and-helped, or enough high-usefulness votes.
  const hasEnoughVotes = input.sampleSize >= thresholds.minSamples;
  if (input.injectedAndHelped) {
    return verdict('confirm', PROBATION_REASONS.injectedAndHelped);
  }
  if (
    input.usefulness !== null &&
    hasEnoughVotes &&
    input.usefulness >= thresholds.confirmThreshold
  ) {
    return verdict('confirm', PROBATION_REASONS.useful);
  }

  // 4. Low-usefulness revert: enough votes but the ratio is below threshold.
  if (
    input.usefulness !== null &&
    hasEnoughVotes &&
    input.usefulness < thresholds.confirmThreshold
  ) {
    return verdict('revert', PROBATION_REASONS.lowUsefulness);
  }

  // 5. Insufficient votes, no hard signal, not confirmed → hold for now.
  return verdict('hold', PROBATION_REASONS.insufficientVotes);
}
