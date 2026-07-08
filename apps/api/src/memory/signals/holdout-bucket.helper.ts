/**
 * Deterministic A/B holdout bucketing for promoted-learning injection
 * (EPIC-212 Phase 3, Task 6 / Pre-flight #7).
 *
 * A scope is stably assigned to the "holdout" arm (lessons computed but
 * NOT injected) or the "injected" arm (default behaviour) by a stable hash
 * of its `scopeId`. Stability matters: a given scope must land in the same
 * arm on every run so the lift measurement is causal — flipping a scope
 * between arms run-to-run would contaminate both arms.
 *
 * Inertness: `fraction <= 0` puts EVERY scope in the injected arm (no
 * suppression, injection unchanged); `fraction >= 1` puts every scope in
 * the holdout arm. In between, the fraction of scopes in the holdout arm
 * approximates `fraction` because the hash is ~uniform on `[0, 1)`.
 */
import type { HoldoutArm } from './holdout-bucket.types';

export type { HoldoutArm } from './holdout-bucket.types';

/**
 * FNV-1a 32-bit hash → normalised to `[0, 1)`. A small, dependency-free,
 * well-distributed hash; the exact algorithm is unimportant beyond being
 * stable across processes (so two API instances bucket a scope identically)
 * and ~uniform (so the holdout fraction is honoured in aggregate).
 */
function hashToUnitInterval(scopeId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < scopeId.length; i += 1) {
    hash ^= scopeId.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to an unsigned 32-bit integer, then normalise.
  const unsigned = hash >>> 0;
  return unsigned / 0x100000000;
}

/**
 * Decide whether a scope is in the holdout arm for the given fraction.
 * A scope with an empty id is never bucketed (treated as injected) so a
 * missing scope can never be accidentally suppressed.
 */
export function resolveHoldoutArm(
  scopeId: string,
  fraction: number,
): HoldoutArm {
  if (typeof scopeId !== 'string' || scopeId.length === 0) {
    return 'injected';
  }
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return 'injected';
  }
  if (fraction >= 1) {
    return 'holdout';
  }
  return hashToUnitInterval(scopeId) < fraction ? 'holdout' : 'injected';
}
