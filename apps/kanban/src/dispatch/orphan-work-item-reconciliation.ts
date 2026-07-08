/**
 * Orphan work item reconciliation.
 *
 * An "orphaned" in-progress item has status="in-progress" but no linked_run_id
 * or current_execution_id. This means it was transitioned to in-progress
 * (typically by a CEO cycle status mutation) without ever being dispatched.
 *
 * These items are invisible to:
 * - dispatchCandidate() (only dispatches "todo" items)
 * - reconcileLinkedRuns() (only processes items with linked_run_id)
 * - isDispatchableWorkItem() (DISPATCHABLE_STATUSES = {"todo"})
 *
 * The fix: detect them during reconciliation and reset to "todo".
 */

export type {
  OrphanReconciliationEntry,
  OrphanReconciliationSummary,
} from "./orphan-work-item-reconciliation.types";

/**
 * Returns true if a work item is in "in-progress" status but has no
 * linked workflow run — meaning it was never dispatched and is stuck.
 */
export function isOrphanedInProgressItem(item: {
  status: string;
  linked_run_id: string | null;
  current_execution_id: string | null;
}): boolean {
  return (
    item.status === "in-progress" &&
    !item.linked_run_id &&
    !item.current_execution_id
  );
}
