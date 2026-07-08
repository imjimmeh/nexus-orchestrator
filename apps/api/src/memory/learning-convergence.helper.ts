/**
 * Pure convergence-snapshot computation for the learning self-improvement
 * feedback loop (work item 88d7654e-ca93-4ffa-8ba5-7065db9506db, milestone 3).
 *
 * Extracted from `MemoryMetricsService` so that service stays under the
 * file-level `max-lines` cap. The per-scope ring buffers are owned by the
 * service (so they can be inspected / aged in unit tests); this module only
 * trims them to the rolling window and computes the per-scope ratios.
 *
 * The convergence ratio is `successes / total` over a rolling window of
 * `learning_convergence_window_days` days. The ring buffers are trimmed in
 * place on every call; expired samples are dropped before the ratio is
 * computed so a long-lived process does not accumulate stale state.
 */
import type { LearningConvergenceSnapshot } from './memory-metrics.types';

const MS_PER_DAY = 86_400_000;

/** Per-scope run-outcome sample stored in the convergence ring buffer. */
interface OutcomeSample {
  at: number;
  outcome: 'success' | 'failure';
}

/**
 * Compute the per-scope convergence snapshots over the rolling window,
 * trimming both ring buffers in place. Scopes with zero in-window samples
 * (after trimming) are omitted from the returned map; a scope with
 * injections but zero outcomes returns a `ratio: 0` snapshot so the operator
 * can distinguish "injected but no run yet" from "no signal at all".
 */
export function computeConvergenceSnapshots(
  injectTimestampsByScope: Map<string, number[]>,
  outcomeTimestampsByScope: Map<string, OutcomeSample[]>,
  windowDays: number,
): Record<string, LearningConvergenceSnapshot> {
  const now = Date.now();
  const cutoff = now - windowDays * MS_PER_DAY;
  const computedAt = new Date(now).toISOString();
  const snapshots: Record<string, LearningConvergenceSnapshot> = {};

  for (const scope of collectActiveScopes(
    injectTimestampsByScope,
    outcomeTimestampsByScope,
  )) {
    trimExpiredSamples(
      scope,
      cutoff,
      injectTimestampsByScope,
      outcomeTimestampsByScope,
    );
    const snapshot = buildScopeSnapshot(
      scope,
      windowDays,
      computedAt,
      injectTimestampsByScope,
      outcomeTimestampsByScope,
    );
    if (snapshot !== null) {
      snapshots[scope] = snapshot;
    }
  }

  return snapshots;
}

/**
 * Collect every `scope` that has at least one lesson-injection OR run-outcome
 * sample. The result is the union of keys across both maps.
 */
function collectActiveScopes(
  injectTimestampsByScope: Map<string, number[]>,
  outcomeTimestampsByScope: Map<string, OutcomeSample[]>,
): string[] {
  const scopes = new Set<string>();
  for (const scope of injectTimestampsByScope.keys()) {
    scopes.add(scope);
  }
  for (const scope of outcomeTimestampsByScope.keys()) {
    scopes.add(scope);
  }
  return [...scopes];
}

/**
 * Trim expired samples from the per-scope ring buffers in place. The window
 * cutoff is inclusive (`<=`) so a sample stamped exactly at `now - windowMs`
 * is dropped.
 */
function trimExpiredSamples(
  scope: string,
  cutoff: number,
  injectTimestampsByScope: Map<string, number[]>,
  outcomeTimestampsByScope: Map<string, OutcomeSample[]>,
): void {
  const injectRing = injectTimestampsByScope.get(scope);
  if (injectRing) {
    dropExpiredFromRing(
      injectRing,
      (entry) => entry <= cutoff,
      () => injectTimestampsByScope.delete(scope),
    );
  }
  const outcomeRing = outcomeTimestampsByScope.get(scope);
  if (outcomeRing) {
    dropExpiredFromRing(
      outcomeRing,
      (entry) => entry.at <= cutoff,
      () => outcomeTimestampsByScope.delete(scope),
    );
  }
}

/**
 * Drop every entry matching the `isExpired` predicate (independent of order)
 * and run `onEmpty` when the ring ends up empty.
 */
function dropExpiredFromRing<T>(
  ring: T[],
  isExpired: (entry: T) => boolean,
  onEmpty: () => void,
): void {
  const kept = ring.filter((entry) => !isExpired(entry));
  ring.length = 0;
  for (const entry of kept) {
    ring.push(entry);
  }
  if (ring.length === 0) {
    onEmpty();
  }
}

/**
 * Build the per-scope convergence snapshot from the (already-trimmed) ring
 * buffers. Returns `null` when the scope has no in-window signal so the
 * caller can omit it from the returned map.
 */
function buildScopeSnapshot(
  scope: string,
  windowDays: number,
  computedAt: string,
  injectTimestampsByScope: Map<string, number[]>,
  outcomeTimestampsByScope: Map<string, OutcomeSample[]>,
): LearningConvergenceSnapshot | null {
  const injectRing = injectTimestampsByScope.get(scope);
  const outcomeRing = outcomeTimestampsByScope.get(scope);
  const inWindowInjectCount = injectRing?.length ?? 0;
  const inWindowOutcomeRing = outcomeRing ?? [];
  const inWindowRuns = inWindowOutcomeRing.length;
  if (inWindowInjectCount === 0 && inWindowRuns === 0) {
    return null;
  }
  const inWindowSuccesses = inWindowOutcomeRing.reduce(
    (count, sample) => (sample.outcome === 'success' ? count + 1 : count),
    0,
  );
  const ratio = inWindowRuns === 0 ? 0 : inWindowSuccesses / inWindowRuns;
  return {
    ratio,
    window_days: windowDays,
    runs_after_lesson: inWindowRuns,
    successes_after_lesson: inWindowSuccesses,
    computed_at: computedAt,
  };
}
