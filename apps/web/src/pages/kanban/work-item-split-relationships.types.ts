import { WorkItem } from "@/lib/api/work-items.types";

export interface SplitRelationshipRow {
  id: string;
  item: WorkItem | undefined;
}

export interface SplitRelationshipView {
  parent: SplitRelationshipRow | undefined;
  children: SplitRelationshipRow[];
  childrenDone: number;
  childrenTotal: number;
}
