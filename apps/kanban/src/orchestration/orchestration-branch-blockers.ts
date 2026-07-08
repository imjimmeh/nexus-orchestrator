import { ownsTargetBranch } from "../dispatch/target-branch-claims";
import type { WorkItemRecord } from "../dispatch/dispatch-internal.types";
import { filterDispatchableTodo } from "../work-item/work-item-dispatchable.helper";
import type {
  BranchBlockerWorkItem,
  TargetBranchBlocker,
} from "./orchestration-branch-blockers.types";

export function getTargetBranch(
  item: Pick<BranchBlockerWorkItem, "execution_config" | "executionConfig">,
): string | null {
  const config = item.execution_config ?? item.executionConfig;
  const targetBranch = config?.targetBranch ?? config?.target_branch;

  return typeof targetBranch === "string" && targetBranch.trim().length > 0
    ? targetBranch.trim()
    : null;
}

export function findTargetBranchBlocker(
  item: BranchBlockerWorkItem,
  items: BranchBlockerWorkItem[],
): TargetBranchBlocker | null {
  const branch = getTargetBranch(item);
  if (!branch) {
    return null;
  }

  const owners = items.filter(
    (candidate) =>
      candidate.id !== item.id &&
      getTargetBranch(candidate) === branch &&
      ownsTargetBranch(candidate as WorkItemRecord),
  );

  return owners.length > 0 ? { item, branch, owners } : null;
}

export function findTargetBranchBlockers(
  items: BranchBlockerWorkItem[],
): TargetBranchBlocker[] {
  const dispatchableIds = new Set(
    filterDispatchableTodo(
      items.map((item) => ({
        id: item.id,
        status: item.status ?? "",
        type: item.type ?? "story",
        parent_work_item_id: item.parent_work_item_id ?? null,
      })),
    ).map((item) => item.id),
  );

  return items
    .filter((item) => dispatchableIds.has(item.id))
    .map((item) => findTargetBranchBlocker(item, items))
    .filter((blocker): blocker is TargetBranchBlocker => blocker !== null);
}

export function formatTargetBranchBlockerReason(
  projectId: string,
  blocker: TargetBranchBlocker,
): string {
  const ownerLabels = blocker.owners.map((owner) =>
    owner.title ? `${owner.title} (${owner.id})` : owner.id,
  );
  return `Project ${projectId} has todo work blocked by target branch ${blocker.branch}; active owner(s): ${ownerLabels.join(", ")}`;
}
