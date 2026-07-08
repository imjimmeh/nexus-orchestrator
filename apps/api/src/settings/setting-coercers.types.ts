/**
 * Type definitions for the shared setting-coercers module.
 *
 * Kept in a sibling `.types.ts` file per the API lint policy
 * (exported interfaces and type aliases must live next to a
 * matching `<name>.types.ts`).
 */

/**
 * Options for {@link coerceInteger}.
 */
export interface CoerceIntegerOptions {
  /**
   * Inclusive lower bound. Values strictly less than `min` are
   * treated as missing/invalid and produce the `fallback` (or
   * `undefined` when `allowUndefined` is true). Omit to disable
   * the lower bound.
   */
  min?: number;

  /**
   * Inclusive upper bound. Values strictly greater than `max` are
   * treated as missing/invalid and produce the `fallback` (or
   * `undefined` when `allowUndefined` is true). Omit to disable
   * the upper bound.
   */
  max?: number;

  /**
   * When true, a missing/invalid input returns `undefined`
   * instead of `fallback`. This is the contract for settings
   * whose absence is meaningful (e.g. "re-check every drifted
   * row" vs "skip drifted rows" — see
   * `memory-drift.coercion.ts`). Defaults to `false`.
   *
   * Contract:
   *   - `allowUndefined: true` + missing/invalid → `undefined`.
   *   - `allowUndefined: false` (default) + missing/invalid → `fallback`.
   *   - Valid input → `Math.floor(value)` regardless of `allowUndefined`.
   */
  allowUndefined?: boolean;
}
