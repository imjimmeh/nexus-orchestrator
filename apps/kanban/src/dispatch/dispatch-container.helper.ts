import { isDispatchable, type WorkItemType } from "@nexus/kanban-contracts";
import type { WorkItemRecord } from "./dispatch-internal.types";

/**
 * True when the given work item must never be dispatched directly: it is
 * either an `epic` (a pure container) or a `story` that currently has
 * children in the same project (a container by structure). Consulted by the
 * dispatch core immediately after the `status !== "todo"` skip so no
 * container item ever reaches `coreClient.requestWorkflowRun`.
 */
export function isContainerCandidate(
  item: WorkItemRecord,
  childrenParentIds: ReadonlySet<string>,
): boolean {
  return !isDispatchable(
    item.type as WorkItemType,
    childrenParentIds.has(item.id),
  );
}
