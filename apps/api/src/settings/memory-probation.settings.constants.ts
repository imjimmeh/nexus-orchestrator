/**
 * System-setting keys, defaults, and non-throwing coercers for the
 * provisional-memory probation evaluator (EPIC-212 Phase-3 Task 7).
 *
 * Four operator-tunable knobs:
 *   - `memory_probation_evaluator_enabled` (default `false`) — master
 *     switch. When `false` the evaluator pass is a no-op BEFORE any DB
 *     query (zero overhead). When `true` it confirms good provisional
 *     auto-promotions past their probation window.
 *   - `memory_probation_auto_revert_enabled` (default `false`) — gates the
 *     riskiest action. When `false` (with the evaluator on) a would-revert
 *     verdict runs in SHADOW MODE (emits `memory.probation.shadow.v1`
 *     without archiving). When `true` a revert archives the bad
 *     auto-promotion (archive-only, never hard-delete — recoverable).
 *   - `memory_probation_usefulness_threshold` (0–1, default 0.5) — the
 *     usefulness ratio at/above which a provisional segment past probation
 *     is confirmed (with at least `memory_probation_min_samples` votes).
 *   - `memory_probation_min_samples` (>= 1, default 3) — minimum votes
 *     before usefulness can drive a confirm / low-usefulness revert verdict.
 *
 * Mirrors the fragment convention in `memory-decay-value.settings.constants.ts`
 * (`as const` keys, hardcoded defaults, non-throwing `coerceX` helpers, and a
 * `SYSTEM_SETTING_DEFAULTS` fragment spread into the global registry so the
 * knobs seed on a fresh DB).
 */

export const MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING =
  'memory_probation_evaluator_enabled' as const;

export const MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING =
  'memory_probation_auto_revert_enabled' as const;

export const MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING =
  'memory_probation_usefulness_threshold' as const;

export const MEMORY_PROBATION_MIN_SAMPLES_SETTING =
  'memory_probation_min_samples' as const;

/** Default for `memory_probation_evaluator_enabled` — off (inert). */
export const MEMORY_PROBATION_EVALUATOR_ENABLED_DEFAULT = false;

/** Default for `memory_probation_auto_revert_enabled` — off (shadow-first). */
export const MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT = false;

/** Hardcoded default usefulness floor to confirm a provisional segment. */
export const MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT = 0.5;

/** Hardcoded default minimum vote count before usefulness drives a verdict. */
export const MEMORY_PROBATION_MIN_SAMPLES_DEFAULT = 3;

/**
 * Coerce an arbitrary stored value into a boolean. Accepts a real boolean,
 * the string forms `"true"`/`"false"`/`"1"`/`"0"`/`"yes"`/`"no"`, and the
 * numbers `0`/`1`. Any other value falls back to the supplied fallback so a
 * UI typo can never silently enable the evaluator. Non-throwing by design.
 */
export function coerceMemoryProbationEvaluatorEnabled(
  value: unknown,
  fallback: boolean = MEMORY_PROBATION_EVALUATOR_ENABLED_DEFAULT,
): boolean {
  return coerceFlag(value, fallback);
}

/**
 * Coerce the `memory_probation_auto_revert_enabled` setting into a boolean.
 * Same accepted forms as {@link coerceMemoryProbationEvaluatorEnabled}; a
 * malformed value falls back to the default so a typo can never silently
 * enable destructive auto-revert.
 */
export function coerceMemoryProbationAutoRevertEnabled(
  value: unknown,
  fallback: boolean = MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT,
): boolean {
  return coerceFlag(value, fallback);
}

/**
 * Coerce the `memory_probation_usefulness_threshold` setting into a number
 * in the `[0, 1]` range. Out-of-range / non-numeric values fall back to the
 * default so an operator typo cannot make the evaluator confirm everything
 * (threshold = 0) or nothing (threshold = 2).
 */
export function coerceMemoryProbationUsefulnessThreshold(
  value: unknown,
  fallback: number = MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return fallback;
  }
  return numeric;
}

/**
 * Coerce the `memory_probation_min_samples` setting into a positive integer
 * (>= 1). A minimum of zero votes would let a single accidental vote drive a
 * verdict, so values below 1 (and non-numeric values) fall back to the
 * default.
 */
export function coerceMemoryProbationMinSamples(
  value: unknown,
  fallback: number = MEMORY_PROBATION_MIN_SAMPLES_DEFAULT,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.floor(numeric);
}

/** Shared boolean coercion used by the two flag coercers above. */
function coerceFlag(value: unknown, fallback: boolean): boolean {
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
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global registry so the
 * provisional-memory probation evaluator knobs (EPIC-212 Phase-3 Task 7) seed
 * on a fresh DB with their canonical defaults and operator-facing
 * descriptions. Every knob is inert by default: the evaluator pass is a no-op
 * before any DB query while `memory_probation_evaluator_enabled` is false, and
 * auto-revert is shadow-first.
 */
export const MEMORY_PROBATION_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING]: {
    value: MEMORY_PROBATION_EVALUATOR_ENABLED_DEFAULT,
    description:
      'Master switch (default false) for the provisional-memory probation evaluator (EPIC-212 Phase-3). While off the evaluator pass is a no-op BEFORE any DB query (zero overhead) and the deterministic Phase-2 loop is untouched. When on, the evaluator confirms good provisional auto-promotions past their probation window (governance_state flips provisional → confirmed). The confirm action is non-destructive and safe; the riskier revert action is additionally gated by memory_probation_auto_revert_enabled.',
  },
  [MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING]: {
    value: MEMORY_PROBATION_AUTO_REVERT_ENABLED_DEFAULT,
    description:
      'Allow the probation evaluator to archive bad provisional auto-promotions (default false, shadow-first). While off (with the evaluator on) a would-revert verdict runs in shadow mode — it emits a memory.probation.shadow.v1 event listing the would-archive rows WITHOUT mutating. When on, a revert sets archived_at on the bad auto-promotion (archive-only — never hard-deleted, so a wrong revert is recoverable). The confirm path runs regardless of this flag.',
  },
  [MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING]: {
    value: MEMORY_PROBATION_USEFULNESS_THRESHOLD_DEFAULT,
    description:
      'Usefulness ratio (0–1, default 0.5) at/above which the probation evaluator confirms a provisional memory segment past its probation window, provided it has at least memory_probation_min_samples votes. A provisional segment whose rolling-window usefulness falls below this threshold (with enough votes), or that is unused/contradicted/drifted, is a revert candidate.',
  },
  [MEMORY_PROBATION_MIN_SAMPLES_SETTING]: {
    value: MEMORY_PROBATION_MIN_SAMPLES_DEFAULT,
    description:
      'Minimum number of explicit usefulness votes (>= 1, default 3) a provisional memory segment must have accumulated before its usefulness ratio can drive a confirm or low-usefulness revert verdict in the probation evaluator. Segments below this vote count are held (no confirm/revert) until they accrue enough feedback.',
  },
};
