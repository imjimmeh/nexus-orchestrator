import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import {
  asRecord,
  isRecord,
  toWorkItemRecord,
} from "./work-item.service.helpers";
import { getDependencyIds, requireWorkItem } from "./work-item-run.helpers";
import type { WorkItemRecord } from "./work-item.types";

export async function getWorkItemExecutionConfig(
  workItems: KanbanWorkItemRepository,
  project_id: string,
  workItemId: string,
): Promise<unknown> {
  const item = await requireWorkItem(project_id, workItemId, workItems);
  return item.execution_config ?? null;
}

export async function upsertWorkItemExecutionConfig(
  workItems: KanbanWorkItemRepository,
  project_id: string,
  workItemId: string,
  data: unknown,
): Promise<WorkItemRecord> {
  const item = await requireWorkItem(project_id, workItemId, workItems);
  const inputConfig = asRecord(data);
  const nextExecutionConfig = isRecord(item.execution_config)
    ? { ...item.execution_config, ...inputConfig }
    : inputConfig;
  const updated = await workItems.save({
    ...item,
    execution_config: nextExecutionConfig,
  });
  return toWorkItemRecord(
    updated,
    await getDependencyIds(workItemId, workItems),
  );
}

export async function getActiveWorkItemAutomationStatuses(
  workItems: KanbanWorkItemRepository,
  project_id: string,
): Promise<string[]> {
  const items = await workItems.findByproject_id(project_id);
  return [...new Set(items.map((item) => item.status))];
}
