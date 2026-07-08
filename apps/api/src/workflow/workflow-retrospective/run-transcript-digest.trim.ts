/**
 * Pure, DB-free timeline-trim policy for the run digest (EPIC-212 Phase-2
 * Task 4).
 *
 * Separated from the service so the token-budget logic is unit-testable
 * without a database or tiktoken: the caller injects a `measure` closure that
 * reports the token cost of a candidate digest, and a set of protected event
 * ids that must never be dropped (the struggle spans, their recovering calls,
 * and anchored error clusters).
 *
 * Drop order: lowest signal first (plain successes before un-anchored
 * failures before anchored failures), oldest first within a signal tier
 * (the input array is chronological). Protected entries are never candidates.
 */
import type {
  DigestTimelineEntry,
  TimelineBudgetResult,
} from './run-transcript-digest.types';

const FAILURE_OUTCOME = 'failure';

const SIGNAL_ANCHORED_FAILURE = 3;
const SIGNAL_FAILURE = 2;
const SIGNAL_OTHER = 1;

/** Signal weight of a timeline entry: higher = more worth keeping. */
export function timelineEntrySignal(entry: DigestTimelineEntry): number {
  if (entry.outcome === FAILURE_OUTCOME) {
    return isNonEmpty(entry.errorCode)
      ? SIGNAL_ANCHORED_FAILURE
      : SIGNAL_FAILURE;
  }
  return SIGNAL_OTHER;
}

/**
 * Trim a chronological timeline down to a token budget, dropping the
 * lowest-signal unprotected entries first. The kept entries are returned in
 * their original chronological order. Never drops a protected entry, even if
 * the budget cannot be met.
 *
 * Dropping is a monotonic prefix operation: `dropOrder` is sorted lowest-signal
 * first, and removing more of its prefix can only shrink the kept token count.
 * We therefore BINARY-SEARCH the smallest prefix length whose remaining digest
 * fits the budget — O(log n) `measure` calls instead of O(n). This is the fix
 * for the 2026-06-29 event-loop wedge, where the old one-drop-per-`measure`
 * loop ran ~1000 synchronous tiktoken encodings over a large blob and pegged
 * the Node event loop for minutes.
 */
export function selectTimelineWithinBudget(
  entries: DigestTimelineEntry[],
  protectedEventIds: ReadonlySet<string>,
  budget: number,
  measure: (kept: DigestTimelineEntry[]) => number,
): TimelineBudgetResult {
  if (measure(entries) <= budget) {
    return { kept: entries, droppedCount: 0 };
  }

  const dropOrder = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !protectedEventIds.has(entry.eventId))
    .sort(
      (a, b) =>
        timelineEntrySignal(a.entry) - timelineEntrySignal(b.entry) ||
        a.index - b.index,
    );

  const keptAfterDropping = (prefixLength: number): DigestTimelineEntry[] => {
    const removed = new Set(
      dropOrder.slice(0, prefixLength).map(({ entry }) => entry.eventId),
    );
    return entries.filter((entry) => !removed.has(entry.eventId));
  };

  // Smallest prefix length in [0, dropOrder.length] whose kept set fits budget.
  // Defaults to dropping ALL unprotected entries when even that cannot fit
  // (protected entries are never candidates, mirroring the old behaviour).
  let lo = 0;
  let hi = dropOrder.length;
  let best = dropOrder.length;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (measure(keptAfterDropping(mid)) <= budget) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const kept = keptAfterDropping(best);
  return { kept, droppedCount: entries.length - kept.length };
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
