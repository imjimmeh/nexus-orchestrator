/**
 * Pure helper module. No NestJS decorators, no DI.
 *
 * Shared coercion helpers for SystemSettingsService values
 * (and any other JSON-serialisable values that originate from
 * untrusted storage). Lives outside the `*settings.constants.ts`
 * files because it is policy-agnostic: callers compose the
 * `min` / `max` / `allowUndefined` options to express their own
 * domain constraints (e.g. "non-negative day count",
 * "positive integer with a 1-based floor"). Domain-specific
 * wrappers (e.g. `coerceGraceDays`) continue to live next to
 * their callers and delegate to `coerceInteger` so the policy
 * stays in one place.
 */

import type { CoerceIntegerOptions } from './setting-coercers.types';

/**
 * Overload: when `options.allowUndefined` is `true`, the result
 * is `number | undefined`. This is the contract for settings
 * whose absence is meaningful (e.g. the drift recheck-after-ms
 * override — see `memory-drift-detection.service.ts`).
 */
export function coerceInteger(
  value: unknown,
  fallback: number,
  options: CoerceIntegerOptions & { allowUndefined: true },
): number | undefined;
/**
 * Overload (and implementation signature): any other shape —
 * `options` omitted, `allowUndefined` absent, or explicitly
 * `false` — keeps the original `number` return type so callers
 * can keep their `number`-typed sinks without runtime
 * assertions. The implementation body internally still has the
 * `number | undefined` union to cover the other overload; the
 * compiler narrows it back to `number` for this public
 * signature because the body returns `fallback` (a `number`)
 * on the missing/invalid branch.
 */
export function coerceInteger(
  value: unknown,
  fallback: number,
  options?: CoerceIntegerOptions & { allowUndefined?: false },
): number;
export function coerceInteger(
  value: unknown,
  fallback: number,
  options?: CoerceIntegerOptions,
): number | undefined;

/**
 * Coerce an arbitrary `unknown` value into an integer.
 *
 * Pipeline:
 *   - `undefined`, `null`, empty string `""`, and whitespace-only
 *     strings are the missing case (no `number` candidate at all).
 *   - Non-empty trimmed strings are parsed via
 *     `Number.parseInt(value, 10)`. Whitespace around the digits
 *     is tolerated (`"  7  "` → `7`).
 *   - Native `number` values pass through directly.
 *   - Anything else (booleans, objects, arrays, etc.) is treated
 *     as the missing case.
 *
 * Once a numeric candidate is resolved:
 *   - `NaN`, `+Infinity`, and `-Infinity` are rejected
 *     (`Number.isFinite` is false for all three).
 *   - Values outside `[options.min, options.max]` (when supplied)
 *     are rejected.
 *   - Accepted values are returned as `Math.floor(numeric)` so the
 *     helper always yields an integer (truncation, not rounding —
 *     `42.9` becomes `42`).
 *
 * Missing/invalid output:
 *   - `options.allowUndefined === true` → returns `undefined`.
 *   - Otherwise → returns `fallback`.
 *
 * The `fallback` parameter is typed as `number` for ergonomic
 * caller sites where the default is a named constant. Callers that
 * only ever want the "missing → undefined" contract (with the
 * fallback path unreachable) can pass `undefined as never` to
 * satisfy the signature without leaking a non-zero value.
 *
 * @param value - The arbitrary value to coerce (typically read
 *   from SystemSettingsService or a JSON payload).
 * @param fallback - Value returned when `value` is missing/invalid
 *   and `options.allowUndefined` is not true. Must be a `number`
 *   (see above for the `undefined as never` escape hatch).
 * @param options - Optional bounds and `allowUndefined` policy.
 */
export function coerceInteger(
  value: unknown,
  fallback: number,
  options?: CoerceIntegerOptions,
): number | undefined {
  const min = options?.min;
  const max = options?.max;
  const allowUndefined = options?.allowUndefined === true;

  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (
    !Number.isFinite(numeric) ||
    (typeof min === 'number' && numeric < min) ||
    (typeof max === 'number' && numeric > max)
  ) {
    return allowUndefined ? undefined : fallback;
  }

  return Math.floor(numeric);
}
