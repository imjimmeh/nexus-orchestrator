import type { WorkItemRecord } from "./dispatch-internal.types";
import { getTargetBranch, ownsTargetBranch } from "./target-branch-claims";
import { findTargetFileContention } from "./plan-contention.helper";
import type { DispatchResult } from "./dispatch.service.types";

export { getTargetBranch };

export function collectActiveTargetBranches(
  items: WorkItemRecord[],
): Set<string> {
  const targetBranches = new Set<string>();
  for (const item of items) {
    if (!ownsTargetBranch(item)) continue;
    const targetBranch = getTargetBranch(item);
    if (targetBranch) targetBranches.add(targetBranch);
  }
  return targetBranches;
}

/**
 * Checks target-file contention and target-branch exclusivity, then claims the
 * branch slot if the item is cleared to dispatch.
 *
 * Returns `false` when the item should be skipped (and pushes the skip reason
 * into `context.result`), `true` when the slot was successfully claimed.
 */
export function claimDispatchSlot(
  item: WorkItemRecord,
  context: {
    claimedTargetBranches: Set<string>;
    inFlightItems: WorkItemRecord[];
    result: DispatchResult;
  },
): boolean {
  const contendingId = findTargetFileContention(item, context.inFlightItems);
  if (contendingId) {
    context.result.skipped.push({
      workItemId: item.id,
      reason: "target_files_contention_detected",
      detail: `Overlaps in-flight item ${contendingId}`,
    });
    return false;
  }

  const targetBranch = getTargetBranch(item);
  if (targetBranch && context.claimedTargetBranches.has(targetBranch)) {
    context.result.skipped.push({
      workItemId: item.id,
      reason: "target_branch_already_dispatched",
      detail: targetBranch,
    });
    return false;
  }

  if (targetBranch) context.claimedTargetBranches.add(targetBranch);
  return true;
}
