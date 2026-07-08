import { WorkItem } from "@/lib/api/work-items.types";

export interface WorkItemHierarchy {
  /**
   * Items with no parent, or whose parentWorkItemId does not resolve to
   * another item in the same input list (e.g. the parent lives outside the
   * current filter/column). Every item in the input list appears exactly
   * once, either here or nested under its parent in childrenByParentId.
   */
  roots: WorkItem[];
  /** Children grouped by their parentWorkItemId, in original list order. */
  childrenByParentId: Record<string, WorkItem[]>;
}
