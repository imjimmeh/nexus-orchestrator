/**
 * Pure A/B holdout-lift computation (EPIC-212 Phase 3, Task 6).
 *
 * Lift is the causal value of the learning loop: the convergence ratio of
 * runs in the "injected" arm (promoted lessons actually injected) minus the
 * convergence ratio of runs in the "holdout" arm (promoted lessons computed
 * but suppressed). A positive lift means the injected lessons measurably
 * raised the success rate above the unaided baseline.
 *
 *   lift = convergence(injected_arm) − convergence(holdout_arm)
 *
 * The computation is separated from the in-memory ring buffers so it can be
 * unit-tested in isolation; `MemoryMeasurementState` trims its per-arm rings
 * to the rolling window and passes the resulting tallies here.
 */
import type { ArmTally } from './learning-lift.types';

export type { ArmTally } from './learning-lift.types';

/**
 * Convergence ratio for a single arm: `successes / runs`, or `0` when the
 * arm has no in-window runs (the same "undefined → 0" normalisation the
 * convergence snapshot uses).
 */
export function armRatio(tally: ArmTally): number {
  return tally.runs <= 0 ? 0 : tally.successes / tally.runs;
}

/**
 * Compute the holdout lift, or `null` when it cannot be measured.
 *
 * Returns `null` when the holdout arm has zero in-window runs — without a
 * counterfactual there is no lift to report. This is the default state when
 * `learning_holdout_fraction = 0` (no scope is ever bucketed into the
 * holdout arm), so lift is reported `null` and the loop's behaviour is
 * unchanged.
 */
export function computeLift(
  injected: ArmTally,
  holdout: ArmTally,
): number | null {
  if (holdout.runs <= 0) {
    return null;
  }
  return armRatio(injected) - armRatio(holdout);
}
