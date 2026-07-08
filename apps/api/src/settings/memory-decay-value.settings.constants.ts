/**
 * System-setting keys, bounds, and non-throwing coercers for the
 * usefulness-aware decay value predicate (EPIC-212 Phase-3 Task 2).
 *
 * Three operator-tunable knobs:
 *   - `decay_value_predicate_mode` (`legacy` | `shadow` | `enforce`)
 *     selects how the `MemoryDecayReaperService` treats the value
 *     predicate. `legacy` (default) is byte-identical to today;
 *     `shadow` observes + emits without mutating; `enforce` (wired
 *     in Task 3) lets the predicate drive archival.
 *   - `memory_decay_usefulness_threshold` (0–1) — usefulness ratio
 *     at/above which a stale row is kept by the value predicate.
 *   - `memory_decay_usefulness_min_samples` (>= 1) — minimum votes
 *     before usefulness may drive a keep/archive verdict.
 *
 * Mirrors the fragment convention in
 * `memory-feedback-window-days.constants.ts` and
 * `governance.settings.constants.ts`: `as const` keys, hardcoded
 * defaults, non-throwing `coerceX` helpers, and a
 * `SYSTEM_SETTING_DEFAULTS` fragment spread into the global
 * registry.
 */

import type { DecayValuePredicateMode } from '../memory/memory-decay.value-predicate.types';

export const DECAY_VALUE_PREDICATE_MODE_SETTING =
  'decay_value_predicate_mode' as const;

export const MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING =
  'memory_decay_usefulness_threshold' as const;

export const MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING =
  'memory_decay_usefulness_min_samples' as const;

/**
 * `eviction_value_predicate_enabled` (EPIC-212 Phase-3 Task 3) — when
 * `true`, the `MemoryEvictionReaperService` consults the SAME shared
 * memory-retention predicate (`decideMemoryRetentionKeep`) before
 * deleting an idle low-access row, so a high-usefulness / pinned /
 * injected-and-helped row is never evicted. Reuses the
 * `memory_decay_usefulness_threshold` / `memory_decay_usefulness_min_samples`
 * knobs above — no duplicate threshold keys. Default `false` keeps the
 * eviction reaper byte-identical to the pre-Phase-3 behaviour.
 */
export const EVICTION_VALUE_PREDICATE_ENABLED_SETTING =
  'eviction_value_predicate_enabled' as const;

/** Allowed `decay_value_predicate_mode` values, in escalation order. */
export const DECAY_VALUE_PREDICATE_MODES: readonly DecayValuePredicateMode[] = [
  'legacy',
  'shadow',
  'enforce',
];

/** Default mode — byte-identical to the pre-Phase-3 reaper. */
export const DECAY_VALUE_PREDICATE_MODE_DEFAULT: DecayValuePredicateMode =
  'legacy';

/** Hardcoded default usefulness keep threshold. */
export const MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT = 0.6;

/** Hardcoded default minimum vote count before usefulness counts. */
export const MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT = 3;

/** Default for `eviction_value_predicate_enabled` — off (byte-identical). */
export const EVICTION_VALUE_PREDICATE_ENABLED_DEFAULT = false;

/**
 * Coerce an arbitrary stored value into a valid
 * {@link DecayValuePredicateMode}. Accepts a case-insensitive
 * trimmed string match against {@link DECAY_VALUE_PREDICATE_MODES};
 * any other value falls back to the supplied fallback (or the
 * hardcoded `legacy` default). Non-throwing by design so a UI typo
 * can never enable the predicate or crash the reaper.
 */
export function coerceDecayValuePredicateMode(
  value: unknown,
  fallback: DecayValuePredicateMode = DECAY_VALUE_PREDICATE_MODE_DEFAULT,
): DecayValuePredicateMode {
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    const match = DECAY_VALUE_PREDICATE_MODES.find(
      (mode) => mode === normalised,
    );
    if (match !== undefined) {
      return match;
    }
  }
  return fallback;
}

/**
 * Coerce the `memory_decay_usefulness_threshold` setting into a
 * number in the `[0, 1]` range. Out-of-range / non-numeric values
 * fall back to the default so an operator typo cannot make the
 * predicate keep everything (threshold = 0) or nothing
 * (threshold = 2).
 */
export function coerceMemoryDecayUsefulnessThreshold(
  value: unknown,
  fallback: number = MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
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
 * Coerce the `memory_decay_usefulness_min_samples` setting into a
 * positive integer (>= 1). A minimum of zero votes would let a
 * single accidental vote drive a keep verdict, so values below 1
 * (and non-numeric values) fall back to the default.
 */
export function coerceMemoryDecayUsefulnessMinSamples(
  value: unknown,
  fallback: number = MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
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

/**
 * Coerce the `eviction_value_predicate_enabled` setting into a
 * boolean. Accepts a real boolean, the string forms
 * `"true"`/`"false"`/`"1"`/`"0"`/`"yes"`/`"no"` (operator-form a UI
 * may round-trip), and the numbers `0`/`1`. Any other value falls
 * back to the default so a typo can never silently enable the
 * eviction value predicate. Non-throwing by design.
 */
export function coerceEvictionValuePredicateEnabled(
  value: unknown,
  fallback: boolean = EVICTION_VALUE_PREDICATE_ENABLED_DEFAULT,
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
 * `SYSTEM_SETTING_DEFAULTS` fragment — spread into the global
 * registry so the decay value-predicate knobs (and the eviction
 * parity flag) seed on a fresh DB with their canonical defaults and
 * operator-facing descriptions.
 */
export const MEMORY_DECAY_VALUE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [DECAY_VALUE_PREDICATE_MODE_SETTING]: {
    value: DECAY_VALUE_PREDICATE_MODE_DEFAULT,
    description:
      'Usefulness-aware decay predicate mode for the nightly MemoryDecayReaper (EPIC-212 Phase-3). `legacy` (default) applies the exempt-by-source + confidence-floor behaviour unchanged. `shadow` applies the legacy behaviour to the DB byte-identically but emits a memory.decay.shadow.v1 event comparing the would-archive set under the value predicate (which preserves useful-but-stale rows) against the legacy set. `enforce` (Phase-3 Task 3) lets the value predicate short-circuit archival. Default-off keeps the deterministic loop intact.',
  },
  [MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING]: {
    value: MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT,
    description:
      'Usefulness ratio (0–1, default 0.6) at/above which the decay value predicate keeps a stale memory segment instead of decaying it. A segment whose rolling-window usefulness from explicit agent feedback meets this threshold (with at least memory_decay_usefulness_min_samples votes) is preserved even when its confidence has decayed below the floor.',
  },
  [MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING]: {
    value: MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_DEFAULT,
    description:
      'Minimum number of explicit usefulness votes (>= 1, default 3) a memory segment must have accumulated in the feedback window before its usefulness ratio can drive a decay keep/archive verdict. Segments below this vote count fall back to the legacy confidence-decay math regardless of their (low-sample) usefulness ratio.',
  },
  [EVICTION_VALUE_PREDICATE_ENABLED_SETTING]: {
    value: EVICTION_VALUE_PREDICATE_ENABLED_DEFAULT,
    description:
      'When true (default false), the nightly MemoryEvictionReaper consults the shared usefulness-aware retention predicate before deleting an idle low-access memory segment (EPIC-212 Phase-3). A high-usefulness, pinned, or injected-and-helped segment is skipped (never evicted) even when it is idle and below the access-count floor. Reuses memory_decay_usefulness_threshold and memory_decay_usefulness_min_samples. Default-off leaves eviction byte-identical to the pre-Phase-3 behaviour and the reaper degrades to today fail-soft when the feedback service is unavailable.',
  },
};
