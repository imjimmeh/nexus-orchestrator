import type {
  DispatchResult,
  DispatchSelectedWorkItemsInput,
} from "./dispatch.service.types";
import type { DispatchServiceDeps } from "./dispatch-internal.types";
import { dispatchWorkItems } from "./dispatch-work-items.core";

/**
 * Free-function entry point retained for the MCP tool spec and the
 * `dispatch-selected-work-items.tool.spec.ts` test surface. Delegates to the
 * unified `dispatchWorkItems` core with the selected-mode option bundle.
 *
 * Behavioural parity with the M2 implementation is preserved by the option
 * flags wired through `dispatchWorkItems`.
 */
export async function dispatchSelectedWorkItems(
  deps: DispatchServiceDeps,
  input: DispatchSelectedWorkItemsInput,
): Promise<DispatchResult> {
  return dispatchWorkItems(deps, {
    projectId: input.projectId,
    workflowId: input.workflowId,
    requestedBy: input.requestedBy,
    selectedWorkItemIds: input.workItemIds,
    reconcileRunStatus: true,
    reconcileOrphans: false,
    checkTargetFileContention: false,
    partialFailure: true,
    slots: input.slots,
    maxConcurrentPerAgent: input.maxConcurrentPerAgent,
    maxActivePerProject: input.maxActivePerProject,
    capacitySkipReason: "concurrency_exceeded",
    causationIdPrefix: "kanban:dispatch:selected",
    releaseBranchOnFailure: true,
  });
}
