import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { WorkItemQueryParams } from "../database/repositories/kanban-work-item.repository.types";
import { toRecordsWithDependencies } from "./work-item.service.helpers";
import type { WorkItemRecord } from "./work-item.types";
import type { PaginatedWorkItemRecords } from "./work-item-pagination.types";

function toListOptions(
  maxWorkItems?: number,
): { limit: number; offset: number } | undefined {
  return maxWorkItems != null && maxWorkItems > 0
    ? { limit: maxWorkItems, offset: 0 }
    : undefined;
}

export async function listProjectWorkItems(
  workItems: KanbanWorkItemRepository,
  project_id: string,
  maxWorkItems?: number,
): Promise<WorkItemRecord[]> {
  const items = await workItems.findByproject_id(
    project_id,
    toListOptions(maxWorkItems),
  );
  return toRecordsWithDependencies(items, workItems);
}

export async function listAllWorkItemRecords(
  workItems: KanbanWorkItemRepository,
  maxWorkItems?: number,
): Promise<WorkItemRecord[]> {
  const items = await workItems.findAll(toListOptions(maxWorkItems));
  return toRecordsWithDependencies(items, workItems);
}

export async function queryPaginatedWorkItems(
  workItems: KanbanWorkItemRepository,
  params: WorkItemQueryParams,
): Promise<PaginatedWorkItemRecords> {
  const { items, total } = await workItems.queryWorkItems(params);
  const records = await toRecordsWithDependencies(items, workItems);
  return { items: records, total, limit: params.limit, offset: params.offset };
}
