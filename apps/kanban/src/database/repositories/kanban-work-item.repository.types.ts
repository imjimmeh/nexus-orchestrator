export const WORK_ITEM_SORT_COLUMNS = {
  updated_at: "item.updated_at",
  created_at: "item.created_at",
  title: "item.title",
  status: "item.status",
  priority: "item.priority",
} as const;

export type WorkItemSortField = keyof typeof WORK_ITEM_SORT_COLUMNS;

export interface WorkItemQueryParams {
  search?: string;
  status?: string[];
  priority?: string[];
  scope?: string[];
  projectId?: string;
  sortBy: WorkItemSortField;
  sortDir: "asc" | "desc";
  limit: number;
  offset: number;
}
