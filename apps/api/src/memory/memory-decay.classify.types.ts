/**
 * Public type surface for the pure decay classification helpers in
 * `memory-decay.classify.ts`. Lives in a dedicated `*.types.ts` file
 * so the `no-restricted-syntax` rule that forbids exported type
 * aliases / interfaces outside `*.types.ts` files is satisfied.
 */

/**
 * Pure legacy decay classification for a single candidate row. A
 * discriminated union so the I/O layer narrows `decayedConfidence`
 * without a non-null assertion:
 *   - `skipped` — exempt source, null touch, in-grace, or no
 *     confidence to decay.
 *   - `decayed` — confidence decremented but still at/above the floor.
 *   - `archived` — decayed confidence fell below the floor.
 */
export type DecayClassification =
  | { outcome: 'skipped' }
  | { outcome: 'decayed'; decayedConfidence: number }
  | { outcome: 'archived'; decayedConfidence: number };
