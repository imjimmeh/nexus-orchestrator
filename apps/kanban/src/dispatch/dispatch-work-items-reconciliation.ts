import { Logger } from "@nestjs/common";
import type { WorkflowRunStatusV1 } from "@nexus/core";
import { isOrphanedInProgressItem } from "./orphan-work-item-reconciliation";
import type { OrphanReconciliationEntry } from "./orphan-work-item-reconciliation.types";
import { resolveCorrelationId } from "./dispatch-run-link.helper";
import { getTargetBranch } from "./target-branch-claims";
import type {
  DispatchCoreDeps,
  DispatchCoreOptions,
  ReconcileScope,
} from "./dispatch-core.types";
import type { DispatchRunReconciliationSummary } from "./dispatch.service.types";
import type { WorkItemRecord } from "./dispatch-internal.types";
import { TERMINAL_RUN_STATUSES } from "./dispatch-internal.types";

const logger = new Logger("DispatchReconciliation");

export function buildReconcileScope(
  requestedItems: WorkItemRecord[],
  options: DispatchCoreOptions,
): ReconcileScope {
  if (!options.selectedWorkItemIds) {
    return {
      selectedIds: new Set(),
      selectedAgentIds: new Set(),
      selectedTargetBranches: new Set(),
    };
  }
  const projectItems = requestedItems.filter(
    (item) => item.project_id === options.projectId,
  );
  return {
    selectedIds: new Set(options.selectedWorkItemIds),
    selectedAgentIds: new Set(
      projectItems
        .map((item) => item.assigned_agent_id)
        .filter((id): id is string => typeof id === "string"),
    ),
    selectedTargetBranches: new Set(
      projectItems
        .map(getTargetBranch)
        .filter((branch): branch is string => branch !== undefined),
    ),
  };
}

export async function refreshRequestedItems(
  deps: DispatchCoreDeps,
  options: DispatchCoreOptions,
  requestedById: Map<string, WorkItemRecord>,
): Promise<void> {
  if (!options.selectedWorkItemIds) return;
  try {
    const refreshed = await deps.workItems.findByIds(
      options.selectedWorkItemIds,
    );
    requestedById.clear();
    for (const item of refreshed) requestedById.set(item.id, item);
  } catch {
    // Best-effort refresh; the launch loop tolerates stale items.
  }
}

/**
 * Dispatches to either the full or selected-scope reconciler based on mode.
 */
export async function reconcileStaleRuns(
  deps: DispatchCoreDeps,
  params: {
    selectedMode: boolean;
    options: DispatchCoreOptions;
    projectItems: WorkItemRecord[];
    requestedItems: WorkItemRecord[];
    requestedById: Map<string, WorkItemRecord>;
    result: DispatchRunReconciliationSummary;
  },
): Promise<void> {
  if (params.selectedMode) {
    const reconcileScope = buildReconcileScope(
      params.requestedItems,
      params.options,
    );
    await reconcileSelectedScope(deps, {
      projectItems: params.projectItems,
      reconcileScope,
      requestedById: params.requestedById,
      result: params.result,
    });
    return;
  }
  await reconcileAllLinkedRuns(deps, params.projectItems, params.result, true);
}

export async function reconcileAllLinkedRuns(
  deps: DispatchCoreDeps,
  items: WorkItemRecord[],
  result: DispatchRunReconciliationSummary,
  pushCoreStatusUnavailableSkip: boolean,
): Promise<void> {
  for (const item of items) {
    await clearTerminalLinkedRun(
      deps,
      item,
      result,
      pushCoreStatusUnavailableSkip,
    );
  }
}

export async function reconcileSelectedScope(
  deps: DispatchCoreDeps,
  params: {
    projectItems: WorkItemRecord[];
    reconcileScope: ReconcileScope;
    requestedById: Map<string, WorkItemRecord>;
    result: DispatchRunReconciliationSummary;
  },
): Promise<void> {
  for (const item of params.projectItems) {
    if (!item.linked_run_id) continue;
    const targetBranch = getTargetBranch(item);
    if (
      !params.reconcileScope.selectedIds.has(item.id) &&
      (!item.assigned_agent_id ||
        !params.reconcileScope.selectedAgentIds.has(item.assigned_agent_id)) &&
      (!targetBranch ||
        !params.reconcileScope.selectedTargetBranches.has(targetBranch))
    ) {
      continue;
    }
    const cleared = await clearTerminalLinkedRun(
      deps,
      item,
      params.result,
      false,
    );
    if (!cleared) continue;
    const requestedItem = params.requestedById.get(item.id);
    if (requestedItem) {
      requestedItem.linked_run_id = null;
      requestedItem.current_execution_id = null;
    }
  }
}

export async function reconcileOrphans(
  deps: DispatchCoreDeps,
  items: WorkItemRecord[],
  result: { orphanReconciled: OrphanReconciliationEntry[] },
): Promise<void> {
  if (!deps.workItemService) return;
  for (const item of items) {
    if (
      !isOrphanedInProgressItem({
        status: item.status,
        linked_run_id: item.linked_run_id ?? null,
        current_execution_id: item.current_execution_id ?? null,
      })
    )
      continue;

    try {
      await deps.workItemService.updateStatus(item.project_id, item.id, "todo");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to reset orphaned in-progress item ${item.id}: ${message}`,
      );
      continue;
    }

    item.status = "todo";
    result.orphanReconciled.push({
      workItemId: item.id,
      previousStatus: "in-progress",
    });
  }
}

export async function clearTerminalLinkedRun(
  deps: DispatchCoreDeps,
  item: WorkItemRecord,
  result: DispatchRunReconciliationSummary,
  pushCoreStatusUnavailableSkip: boolean,
): Promise<boolean> {
  if (!item.linked_run_id) return false;

  let status: WorkflowRunStatusV1;
  try {
    status = await deps.coreClient.getWorkflowRunStatus(
      item.linked_run_id,
      resolveCorrelationId(deps.requestContext),
    );
  } catch (error) {
    if (pushCoreStatusUnavailableSkip) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      result.skipped.push({
        workItemId: item.id,
        reason: "core_status_unavailable",
        detail,
      });
    }
    return false;
  }

  if (!TERMINAL_RUN_STATUSES.has(status.status)) return false;

  const runId = item.linked_run_id;
  const shouldResetProvisionFailure =
    item.status === "in-progress" &&
    status.status === "FAILED" &&
    status.current_step_id === "provision_worktree";
  const cleared = await deps.workItems.clearRunLinksIfMatches(
    item.project_id,
    item.id,
    runId,
    status.status,
  );
  if (!cleared) return false;

  item.linked_run_id = null;
  item.current_execution_id = null;
  if (shouldResetProvisionFailure && deps.workItemService) {
    await deps.workItemService.updateStatus(item.project_id, item.id, "todo");
    item.status = "todo";
  }

  result.reconciled.push({
    workItemId: item.id,
    runId,
    status: status.status,
  });
  return true;
}
