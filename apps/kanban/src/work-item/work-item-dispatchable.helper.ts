import { isDispatchable, type WorkItemType } from "@nexus/kanban-contracts";

/**
 * Shared "is this todo item actually dispatchable" predicate. Wraps
 * `isDispatchable` (container-type guard: epics and any work item with
 * children are never individually dispatchable) so every read predicate
 * that answers "is there dispatchable todo work" agrees with the real
 * dispatch loop (`dispatch-work-items.core.ts`, Task 8). Without this,
 * the board/CEO-decision layer could believe an epic or a
 * parent-with-children is ready to dispatch when it never actually will
 * be.
 */
interface DispatchableCandidate {
  id: string;
  status: string;
  type: string;
  parent_work_item_id: string | null;
}

export function filterDispatchableTodo<T extends DispatchableCandidate>(
  items: T[],
): T[] {
  const parentIds = new Set(
    items
      .map((i) => i.parent_work_item_id)
      .filter((id): id is string => id != null),
  );
  return items.filter(
    (i) =>
      i.status === "todo" &&
      isDispatchable(i.type as WorkItemType, parentIds.has(i.id)),
  );
}
