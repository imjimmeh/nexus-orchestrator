import type { WorkItemType } from "@nexus/kanban-contracts";

/** Client-side mirror of the fields `assertWorkItemInvariants` (apps/kanban)
 * validates server-side: type, the type of the currently selected parent (if
 * any), and story points. */
export interface WorkItemTypeFieldsInput {
  type: WorkItemType;
  parentType?: WorkItemType | null;
  storyPoints?: number | null;
}

export interface WorkItemTypeFieldErrors {
  parentWorkItemId?: string;
  storyPoints?: string;
}
