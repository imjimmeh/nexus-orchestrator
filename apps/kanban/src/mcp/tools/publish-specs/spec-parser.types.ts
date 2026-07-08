export type WorkItemStatus =
  | "backlog"
  | "todo"
  | "refinement"
  | "in-progress"
  | "in-review"
  | "ready-to-merge"
  | "blocked"
  | "done";

export interface SpecParseResult {
  sourceId: string;
  itemId?: string;
  title: string;
  priority: string;
  scope: "standard" | "large";
  status?: WorkItemStatus;
  body: string;
  sourcePath: string;
  sourceHash: string;
  executionConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dependsOnSourceIds: string[];
}
