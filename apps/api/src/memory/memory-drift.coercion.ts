/**
 * Coercion helpers for the `MemoryDriftDetectionService` settings
 * (work item 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * Splitting the coercers out of the service file keeps the
 * service focused on its main flow and lets the milestone-4 test
 * file import the helpers directly without spinning up the
 * NestJS DI container. The coercion pattern mirrors the decay
 * reaper's `coerceEnabled` / `coerceGraceDays` /
 * `coerceDailyRate` / `coerceFloor` helpers in
 * `memory-decay.reaper.ts`.
 */

import {
  MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY,
  MEMORY_DRIFT_DEFAULT_ENABLED,
} from './memory-drift.constants';

/**
 * Coerce the `memory_drift_enabled` setting into a boolean. The
 * storage shape is `boolean`; strings like `"false"` / `"0"`
 * are accepted as `false` for the operator-convenience case
 * where a UI form sends the value back as a string. Other
 * non-boolean values fall back to the default (`true`) so a
 * malformed value never silently disables the detector.
 */
export function coerceEnabled(
  value: unknown,
  fallback: boolean = MEMORY_DRIFT_DEFAULT_ENABLED,
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
 * Coerce the `memory_drift_confidence_penalty` setting into a
 * positive number ≤ 1. Returns the hardcoded default for any
 * missing / non-numeric / out-of-range value. The penalty is
 * the magnitude *subtracted* from the segment's confidence on
 * drift detection; a value of 0 disables the penalty (every
 * drifted row keeps its existing confidence) without requiring
 * the operator to flip the kill switch. Negative values (which
 * would inflate confidence) fall back to the default so a UI
 * typo cannot invert the detector's behaviour.
 */
export function coerceConfidencePenalty(
  value: unknown,
  fallback: number = MEMORY_DRIFT_DEFAULT_CONFIDENCE_PENALTY,
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
