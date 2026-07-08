import type { WorkItemRecord } from "./dispatch-internal.types";

const STATUS_CHANGED_EVENT_NAME = "kanban.work_item.status_changed.v1";
const DISPATCH_TARGET_STATUS = "in-progress";

export function buildDispatchWorkItemTriggerInput(
  projectId: string,
  item: WorkItemRecord,
  dependencyIds: string[] = [],
): Record<string, unknown> {
  return {
    event: STATUS_CHANGED_EVENT_NAME,
    scopeId: projectId,
    contextId: item.id,
    workItemId: item.id,
    status: DISPATCH_TARGET_STATUS,
    previousStatus: item.status,
    actor: "system",
    resource: buildDispatchWorkItemResource(item, dependencyIds),
  };
}

function buildDispatchWorkItemResource(
  item: WorkItemRecord,
  dependencyIds: string[],
): Record<string, unknown> {
  return {
    id: item.id,
    project_id: item.project_id,
    title: item.title,
    description: item.description ?? null,
    status: DISPATCH_TARGET_STATUS,
    priority: item.priority,
    type: item.type,
    parentWorkItemId: item.parent_work_item_id ?? null,
    storyPoints: item.story_points ?? null,
    assignedAgentId: item.assigned_agent_id ?? null,
    tokenSpend: item.token_spend ?? 0,
    currentExecutionId: item.current_execution_id ?? null,
    waitingForInput: item.waiting_for_input ?? false,
    executionConfig: item.execution_config ?? undefined,
    metadata: item.metadata ?? null,
    dependsOn: dependencyIds,
    blockedBy: dependencyIds,
    subtasks: [],
    linkedRunId: item.linked_run_id ?? null,
    createdAt: item.created_at.toISOString(),
    updatedAt: item.updated_at.toISOString(),
  };
}
