/**
 * System-setting keys, defaults, and non-throwing coercers for the
 * drift-anchored self-invalidation half of the memory-decay reaper
 * (EPIC-212 Phase-3 Task 4).
 *
 * Two operator-tunable knobs:
 *   - `memory_decay_drift_invalidation_enabled` (boolean, default
 *     `false`) — when `true`, the nightly `MemoryDecayReaper` treats a
 *     row whose `drift_detected_at` is stamped as decay-eligible even
 *     inside its grace window, and accelerates its confidence decay so
 *     a fact whose anchored code reference drifted self-invalidates
 *     faster. Default-off leaves the reaper byte-identical to the
 *     pre-Task-4 behaviour (the drift detector still applies its own
 *     confidence penalty; the reaper simply does not accelerate).
 *   - `memory_decay_drift_penalty_multiplier` (>= 1, default `3`) — the
 *     factor the reaper multiplies the effective `daysElapsed` by for a
 *     drifted row, so the decay math runs faster.
 *
 * Mirrors the fragment convention in
 * `memory-decay-value.settings.constants.ts`: `as const` keys,
 * hardcoded defaults, non-throwing `coerceX` helpers, and a
 * `SYSTEM_SETTING_DEFAULTS` fragment spread into the global registry.
 */

export const MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING =
  'memory_decay_drift_invalidation_enabled' as const;

export const MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING =
  'memory_decay_drift_penalty_multiplier' as const;

/** Default for `memory_decay_drift_invalidation_enabled` — off (byte-identical). */
export const MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_DEFAULT = false;

/** Default decay-acceleration factor applied to a drifted row's daysElapsed. */
export const MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_DEFAULT = 3;

/**
 * Coerce the `memory_decay_drift_invalidation_enabled` setting into a
 * boolean. Accepts a real boolean, the string forms
 * `"true"`/`"false"`/`"1"`/`"0"`/`"yes"`/`"no"` (operator-form a UI may
 * round-trip), and the numbers `0`/`1`. Any other value falls back to
 * the default so a typo can never silently enable drift-accelerated
 * decay. Non-throwing by design.
 */
export function coerceMemoryDecayDriftInvalidationEnabled(
  value: unknown,
  fallback: boolean = MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_DEFAULT,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
      return true;
    }
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
      return false;
    }
    return fallback;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  return fallback;
}

/**
 * Coerce the `memory_decay_drift_penalty_multiplier` setting into a
 * number `>= 1`. A multiplier below 1 would SLOW decay for drifted rows
 * (the opposite of the intent), so values below 1 (and non-numeric
 * values) fall back to the default. Fractional multipliers `>= 1` are
 * allowed so an operator can tune the aggressiveness finely.
 */
export function coerceMemoryDecayDriftPenaltyMultiplier(
  value: unknown,
  fallback: number = MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return numeric;
}

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry
 * so the drift-invalidation knobs seed on a fresh DB with their
 * canonical defaults and operator-facing descriptions.
 */
export const MEMORY_DECAY_DRIFT_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING]: {
    value: MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_DEFAULT,
    description:
      'When true (default false), the nightly MemoryDecayReaper treats a memory segment whose drift_detected_at is stamped by the MemoryDriftDetectionService as decay-eligible even inside its grace window, and multiplies its effective daysElapsed by memory_decay_drift_penalty_multiplier so a fact whose anchored code reference drifted self-invalidates faster (EPIC-212 Phase-3 Task 4). Default-off leaves the reaper byte-identical to Phase-3 Task-3 — the drift detector still applies its own confidence penalty, the reaper just does not accelerate. Additive and fail-soft.',
  },
  [MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING]: {
    value: MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_DEFAULT,
    description:
      "Decay-acceleration factor (>= 1, default 3) the MemoryDecayReaper multiplies a drifted row's effective daysElapsed by when memory_decay_drift_invalidation_enabled is true. A higher value invalidates a drifted memory faster. Only consulted for rows with a non-null drift_detected_at; non-drifted rows decay at the unmodified rate.",
  },
};
