/**
 * Default number of most-recent decision-history entries to return when a
 * caller does not specify a limit. Keeps agent context bounded for
 * long-running projects whose decision log grows by one entry per cycle.
 */
export const DEFAULT_DECISION_HISTORY_LIMIT = 20;

/**
 * Hard upper bound on how many decision-history entries a single call may
 * return, regardless of the caller-supplied limit.
 */
export const MAX_DECISION_HISTORY_LIMIT = 100;

/**
 * Returns the most-recent `limit` items, preserving the input's chronological
 * order (oldest-first WITHIN the returned window). `offset` skips that many of
 * the most-recent items first, paging backwards into history.
 *
 * `limit` is clamped to [1, MAX_DECISION_HISTORY_LIMIT]; when undefined it
 * defaults to DEFAULT_DECISION_HISTORY_LIMIT. `offset` defaults to 0 (min 0).
 */
export function selectRecentWindow<T>(
  items: readonly T[],
  opts?: { limit?: number; offset?: number },
): T[] {
  const effLimit = Math.min(
    Math.max(opts?.limit ?? DEFAULT_DECISION_HISTORY_LIMIT, 1),
    MAX_DECISION_HISTORY_LIMIT,
  );
  const effOffset = Math.max(opts?.offset ?? 0, 0);

  const end = items.length - effOffset;
  if (end <= 0) {
    return [];
  }

  const start = Math.max(0, end - effLimit);
  return items.slice(start, end);
}
