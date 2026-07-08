import type { WorkItemRecord } from "./dispatch-internal.types";

const BRANCH_OWNING_STATUSES = new Set([
  "in-progress",
  "in-review",
  "ready-to-merge",
  "awaiting-pr-merge",
]);

export function ownsTargetBranch(item: WorkItemRecord): boolean {
  return Boolean(
    item.linked_run_id ||
    item.current_execution_id ||
    (item.status && BRANCH_OWNING_STATUSES.has(item.status)),
  );
}

export function getTargetBranch(item: WorkItemRecord): string | undefined {
  const raw = item.execution_config?.targetBranch;
  if (typeof raw !== "string") return undefined;
  const targetBranch = raw.trim();
  return targetBranch.length > 0 ? targetBranch : undefined;
}
