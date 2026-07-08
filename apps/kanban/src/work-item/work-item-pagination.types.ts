import type { WorkItemRecord } from "./work-item.types";

export interface PaginatedWorkItemRecords {
  items: WorkItemRecord[];
  total: number;
  limit: number;
  offset: number;
}
