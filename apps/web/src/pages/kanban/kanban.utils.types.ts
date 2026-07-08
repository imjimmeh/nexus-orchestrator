import type { WorkItemType } from "@nexus/kanban-contracts";
import { WorkItem } from "@/lib/api/work-items.types";

export type WorkItemReadinessGroup = "ready" | "blocked" | "in-flight" | "done";

export interface DependencyReadinessGroup {
  key: WorkItemReadinessGroup;
  title: string;
  description: string;
  items: WorkItem[];
}

export interface WorkItemFormData {
  title: string;
  description: string;
  priority: string;
  dependencyIds: string[];
  /** The type of the currently-selected parent item, if any -- used to
   * validate the parent/child type pairing (canParent). Undefined/omitted
   * skips type-field validation entirely (existing callers that don't yet
   * manage type/parent/points stay unaffected). */
  type?: WorkItemType;
  parentType?: WorkItemType | null;
  storyPoints?: number | null;
}
