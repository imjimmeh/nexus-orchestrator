import { WorkItemLiveState, WorkItemStatus } from "@/lib/api/work-items.types";
import { KANBAN_COLUMNS } from "./kanban.utils";

export const WORK_ITEM_QUERY_KEY = "project-work-items";

const DROPPABLE_ID_SEPARATOR = "::";

export function getInitialCollapsedColumns(): Record<WorkItemStatus, boolean> {
  return {
    backlog: false,
    todo: false,
    refinement: false,
    "in-progress": false,
    "in-review": false,
    "ready-to-merge": false,
    "awaiting-pr-merge": false,
    blocked: false,
    done: false,
  };
}

export function createDroppableId(
  scope: string,
  status: WorkItemStatus,
): string {
  return `${scope}${DROPPABLE_ID_SEPARATOR}${status}`;
}

export function parseStatusFromDroppableId(
  droppableId: string,
): WorkItemStatus | null {
  const parts = droppableId.split(DROPPABLE_ID_SEPARATOR);
  const candidate = parts.at(-1);

  if (!candidate) {
    return null;
  }

  const matchedColumn = KANBAN_COLUMNS.find(
    (column) => column.status === candidate,
  );
  return matchedColumn?.status || null;
}

export function getLiveBadgeClass(state: WorkItemLiveState): string {
  switch (state) {
    case "running":
      return "bg-success text-success-foreground animate-pulse";
    case "queued":
      return "bg-amber-500 text-white animate-pulse";
    case "awaiting-input":
      return "bg-accent-purple text-white animate-pulse";
    case "error":
      return "bg-destructive text-destructive-foreground";
    case "blocked":
      return "bg-warning text-warning-foreground";
    case "completed":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}
