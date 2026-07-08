import type { WorkItemRecord as ContractWorkItemRecord } from "../work-item/work-item.types";
import type { WorkItemRecord } from "./dispatch-internal.types";
import type { ProjectDispatchCapacity } from "./project-dispatch-capacity.types";

type ProjectDispatchContractItem = Pick<
  ContractWorkItemRecord,
  "status" | "linkedRunId" | "currentExecutionId"
>;

export const PROJECT_DISPATCH_ACTIVE_STATUSES = new Set([
  "in-progress",
  "in-review",
  "ready-to-merge",
]);

/**
 * Statuses that are terminal for a work item. A terminal item has finished its
 * lifecycle and must never consume a dispatch slot, even if a cancelled or
 * otherwise terminal run stranded its `linked_run_id`/`current_execution_id`
 * projections (the stale-link clause below would otherwise count it as active).
 */
export const PROJECT_DISPATCH_TERMINAL_STATUSES = new Set(["done"]);

export function isProjectDispatchActive(item: WorkItemRecord): boolean {
  if (item.status && PROJECT_DISPATCH_TERMINAL_STATUSES.has(item.status)) {
    return false;
  }
  return Boolean(
    item.linked_run_id ||
    item.current_execution_id ||
    (item.status && PROJECT_DISPATCH_ACTIVE_STATUSES.has(item.status)),
  );
}

export function countActiveProjectDispatches(items: WorkItemRecord[]): number {
  return items.filter((item) => isProjectDispatchActive(item)).length;
}

export function isProjectDispatchActiveContractItem(
  item: ProjectDispatchContractItem,
): boolean {
  if (item.status && PROJECT_DISPATCH_TERMINAL_STATUSES.has(item.status)) {
    return false;
  }
  return Boolean(
    item.linkedRunId ||
    item.currentExecutionId ||
    (item.status && PROJECT_DISPATCH_ACTIVE_STATUSES.has(item.status)),
  );
}

export function countActiveProjectDispatchContractItems(
  items: ProjectDispatchContractItem[],
): number {
  return items.filter((item) => isProjectDispatchActiveContractItem(item))
    .length;
}

export function resolveProjectDispatchCapacityFromActiveCount(
  initialActiveCount: number,
  maxActive: number,
  acceptedLaunches = 0,
): ProjectDispatchCapacity {
  const activeCount = Math.max(0, initialActiveCount) + acceptedLaunches;
  const normalizedMaxActive = Math.max(0, Math.trunc(maxActive));
  const availableSlots = Math.max(0, normalizedMaxActive - activeCount);

  return {
    maxActive: normalizedMaxActive,
    activeCount,
    availableSlots,
    projectAvailableSlots: availableSlots,
    canLaunchNewWork: availableSlots > 0,
  };
}

export function resolveProjectDispatchCapacity(
  items: WorkItemRecord[],
  maxActive: number,
  acceptedLaunches = 0,
): ProjectDispatchCapacity {
  return resolveProjectDispatchCapacityFromActiveCount(
    countActiveProjectDispatches(items),
    maxActive,
    acceptedLaunches,
  );
}

export function resolveProjectDispatchCapacityForContractItems(
  items: ProjectDispatchContractItem[],
  maxActive: number,
  acceptedLaunches = 0,
): ProjectDispatchCapacity {
  return resolveProjectDispatchCapacityFromActiveCount(
    countActiveProjectDispatchContractItems(items),
    maxActive,
    acceptedLaunches,
  );
}
