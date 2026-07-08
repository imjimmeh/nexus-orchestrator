/**
 * Pure coercion helpers for the `memory_decay_*` SystemSettings
 * keys. Extracted out of `memory-decay.reaper.ts` so the
 * `MemoryDecayReaperService` stays under the project's
 * `max-lines` lint cap and so the coercion contract has a
 * dedicated, unit-testable seam.
 *
 * The helpers are re-exported from `memory-decay.reaper.ts` for
 * backwards compatibility with external consumers
 * (`PostmortemSettingsResolver` and the legacy
 * `MemoryDriftDetectionService` mirror a subset of these
 * semantics) — new code should import from this module directly
 * to avoid the re-export indirection.
 */
import {
  MEMORY_DECAY_DEFAULT_DAILY_RATE,
  MEMORY_DECAY_DEFAULT_ENABLED,
  MEMORY_DECAY_DEFAULT_FLOOR,
} from './memory-decay.constants';

/**
 * Coerce the `memory_decay_enabled` setting into a boolean. The
 * storage shape is `boolean`; strings like `"false"` / `"0"` are
 * accepted as `false` for the operator-convenience case where a
 * UI form sends the value back as a string. Other non-boolean
 * values fall back to the default (`true`) so a malformed value
 * never silently disables the reaper.
 */
export function coerceEnabled(
  value: unknown,
  fallback: boolean = MEMORY_DECAY_DEFAULT_ENABLED,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
      return false;
    }
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
      return true;
    }
    return fallback;
  }
  if (typeof value === 'number') {
    if (value === 0) {
      return false;
    }
    if (value === 1) {
      return true;
    }
    return fallback;
  }
  return fallback;
}

/**
 * Coerce the `memory_decay_daily_rate` setting into a
 * non-negative number. A `dailyRate = 0` effectively disables
 * decay (every row's confidence is preserved forever) without
 * requiring the operator to flip the kill switch. Negative values
 * (which would inflate confidence) fall back to the default so
 * a UI typo cannot invert the reaper's behaviour.
 */
export function coerceDailyRate(
  value: unknown,
  fallback: number = MEMORY_DECAY_DEFAULT_DAILY_RATE,
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

/**
 * Coerce the `memory_decay_floor` setting into a number in the
 * `[0, 1]` range. Values outside the range fall back to the
 * hardcoded default so an out-of-range operator input cannot
 * accidentally make the reaper archive every row (floor = 1.5)
 * or never archive (floor = -1).
 */
export function coerceFloor(
  value: unknown,
  fallback: number = MEMORY_DECAY_DEFAULT_FLOOR,
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
