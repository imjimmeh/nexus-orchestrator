/**
 * System-setting keys and bounds for the EPIC-212 Phase 3 Task 6
 * causal-measurement trio:
 *
 *   1. behaviour-change counter (read-only; default ON);
 *   2. A/B holdout lift (off by default — `learning_holdout_fraction = 0`);
 *   3. cost-per-promoted-memory (no extra knob — reuses the convergence
 *      window and the existing refresh kill switch).
 *
 * Every knob here is additive and inert by default so the deterministic
 * Phase-0/1/2 loop is byte-for-byte intact when nothing is flipped:
 *   - `learning_behaviour_change_enabled = true` is a pure read-only
 *     measurement (it never mutates a memory or changes injection), so it
 *     is safe to ship ON.
 *   - `learning_holdout_fraction = 0` means NO scope is ever bucketed into
 *     the suppress-lessons holdout arm, so injection is unchanged and the
 *     reported lift is `null`.
 *
 * Mirrors the `coerceX` non-throwing convention in
 * `learning-convergence-settings.constants.ts` and
 * `memory-metrics-settings.constants.ts`.
 */

/** Master switch for the post-injection anchored-tool-used behaviour-change counter. */
export const LEARNING_BEHAVIOUR_CHANGE_ENABLED_SETTING =
  'learning_behaviour_change_enabled' as const;

/** Default — ON (read-only measurement, no behaviour change). */
export const LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT = true;

/** Fraction of scopes deterministically bucketed into the suppress-lessons holdout arm. */
export const LEARNING_HOLDOUT_FRACTION_SETTING =
  'learning_holdout_fraction' as const;

/** Default — 0 (holdout OFF: no scope bucketed, injection unchanged, lift = null). */
export const LEARNING_HOLDOUT_FRACTION_DEFAULT = 0;

/** Minimum allowed holdout fraction. */
export const LEARNING_HOLDOUT_FRACTION_MIN = 0;

/** Maximum allowed holdout fraction (a full holdout is permitted for testing/measurement). */
export const LEARNING_HOLDOUT_FRACTION_MAX = 1;

/**
 * Context types in `budget_usage_events` that count toward the
 * cost-per-promoted-memory numerator. Embedding spend is recorded with
 * `context_type='embedding'` (see `EmbeddingProviderService`); the analyst
 * / distillation legs are listed here so they are summed automatically the
 * moment they begin recording with their own context type (they contribute
 * `0` until then — fail-soft, no error).
 */
export const LEARNING_COST_CONTEXT_TYPES: readonly string[] = [
  'embedding',
  'analyst',
  'distillation',
];

/**
 * Coerce an arbitrary value into a boolean flag. Accepts native booleans,
 * `'true'`/`'false'` (case-insensitive), and `1`/`0`. Any other value
 * returns `fallback`.
 */
export function coerceLearningBehaviourChangeEnabled(
  value: unknown,
  fallback = LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return fallback;
}

/**
 * Coerce an arbitrary value into a valid holdout fraction in
 * [LEARNING_HOLDOUT_FRACTION_MIN, LEARNING_HOLDOUT_FRACTION_MAX].
 * Returns `fallback` (default 0) for non-finite or out-of-range input —
 * a malformed setting therefore disables the holdout rather than enabling
 * an unexpected suppression.
 */
export function coerceLearningHoldoutFraction(
  value: unknown,
  fallback = LEARNING_HOLDOUT_FRACTION_DEFAULT,
): number {
  const safeFallback =
    typeof fallback === 'number' &&
    Number.isFinite(fallback) &&
    fallback >= LEARNING_HOLDOUT_FRACTION_MIN &&
    fallback <= LEARNING_HOLDOUT_FRACTION_MAX
      ? fallback
      : LEARNING_HOLDOUT_FRACTION_DEFAULT;

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= LEARNING_HOLDOUT_FRACTION_MIN &&
    value <= LEARNING_HOLDOUT_FRACTION_MAX
  ) {
    return value;
  }

  return safeFallback;
}

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * causal-measurement knobs (EPIC-212 Phase-3 Task 6) seed on a fresh DB with
 * their canonical defaults and operator-facing descriptions. Both knobs are
 * inert by default: the behaviour-change counter is a read-only measurement
 * that never mutates a memory or changes injection, and the holdout fraction
 * defaults to 0 (no scope suppressed, lift reported `null`).
 */
export const LEARNING_MEASUREMENT_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [LEARNING_BEHAVIOUR_CHANGE_ENABLED_SETTING]: {
    value: LEARNING_BEHAVIOUR_CHANGE_ENABLED_DEFAULT,
    description:
      "Enable the post-injection anchored-tool-used behaviour-change counter (EPIC-212 Phase-3). When true (default), after a run that received an injected lesson terminates, the terminal observer scans the run's tool-execution ledger to record whether the lesson's anchored tool/path was actually invoked, surfacing a behaviour-change rate on the Learning Health panel. This is a pure read-only measurement: it never mutates a memory or alters injection, so it is safe to ship ON. Set false to skip the scan entirely.",
  },
  [LEARNING_HOLDOUT_FRACTION_SETTING]: {
    value: LEARNING_HOLDOUT_FRACTION_DEFAULT,
    description:
      "Fraction (0–1, default 0) of scopes deterministically bucketed into the A/B suppress-lessons holdout arm for causal lift measurement (EPIC-212 Phase-3). For a scope in the holdout arm promoted lessons are computed but NOT injected, letting the loop measure lift = convergence(injected arm) − convergence(holdout arm). The default 0 means NO scope is ever bucketed, so injection is unchanged and the reported lift is inert (`null`). Raise it (e.g. 0.1) only to actively measure the loop's causal value.",
  },
};
