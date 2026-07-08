import type { WorkItemType } from "@nexus/kanban-contracts";

export interface WorkItemInvariantInput {
  type: WorkItemType;
  storyPoints?: number | null;
  parentType?: WorkItemType | null;
}
