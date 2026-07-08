/**
 * A/B holdout arm a promoted-learning injection is attributed to
 * (EPIC-212 Phase 3, Task 6).
 *
 * - `injected` — the default arm: the promoted lessons were rendered into
 *   the planning context.
 * - `holdout` — the suppressed arm: the lessons were computed but NOT
 *   injected, used as the causal counterfactual for the lift measurement.
 */
export type HoldoutArm = 'injected' | 'holdout';
