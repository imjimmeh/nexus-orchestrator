import { WorkItem, WorkItemLiveState, WorkItemStatus } from "@/lib/api/work-items.types";
import { validateWorkItemTypeFields } from "@/features/kanban/work-item-type-form.helpers";
import type {
  DependencyReadinessGroup,
  WorkItemFormData,
  WorkItemReadinessGroup,
} from "./kanban.utils.types";

export type {
  DependencyReadinessGroup,
  WorkItemFormData,
  WorkItemReadinessGroup,
} from "./kanban.utils.types";

export const KANBAN_COLUMNS: Array<{
  status: WorkItemStatus;
  title: string;
}> = [
  { status: "backlog", title: "Backlog" },
  { status: "refinement", title: "Refinement" },
  { status: "todo", title: "To Do" },
  { status: "in-progress", title: "In Progress" },
  { status: "in-review", title: "In Review" },
  { status: "ready-to-merge", title: "Ready to Merge" },
  { status: "awaiting-pr-merge", title: "Awaiting PR Merge" },
  { status: "blocked", title: "Blocked" },
  { status: "done", title: "Done" },
];

const IN_FLIGHT_STATUSES = new Set<WorkItemStatus>([
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "awaiting-pr-merge",
]);

function classifyReadiness(
  item: WorkItem,
  byId: Map<string, WorkItem>,
): WorkItemReadinessGroup {
  if (item.status === "done") {
    return "done";
  }

  if (IN_FLIGHT_STATUSES.has(item.status)) {
    return "in-flight";
  }

  if (item.status === "blocked") {
    return "blocked";
  }

  const dependencies = item.dependsOn ?? [];
  const hasUnresolvedDependency = dependencies.some((dependencyId) => {
    const dependency = byId.get(dependencyId);
    return dependency ? dependency.status !== "done" : true;
  });

  if (hasUnresolvedDependency) {
    return "blocked";
  }

  return "ready";
}

export function groupWorkItemsByDependencyReadiness(
  items: WorkItem[],
): DependencyReadinessGroup[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  const grouped: Record<WorkItemReadinessGroup, WorkItem[]> = {
    ready: [],
    blocked: [],
    "in-flight": [],
    done: [],
  };

  for (const item of items) {
    grouped[classifyReadiness(item, byId)].push(item);
  }

  return [
    {
      key: "ready",
      title: "Ready",
      description: "No unresolved prerequisites.",
      items: grouped.ready,
    },
    {
      key: "blocked",
      title: "Blocked",
      description: "Waiting on dependencies or explicit block status.",
      items: grouped.blocked,
    },
    {
      key: "in-flight",
      title: "In-flight",
      description: "Actively being implemented or reviewed.",
      items: grouped["in-flight"],
    },
    {
      key: "done",
      title: "Done",
      description: "Completed and merged.",
      items: grouped.done,
    },
  ];
}

export function groupWorkItemsByStatus(
  items: WorkItem[],
): Record<WorkItemStatus, WorkItem[]> {
  const grouped = {
    backlog: [],
    refinement: [],
    todo: [],
    "in-progress": [],
    "in-review": [],
    "ready-to-merge": [],
    "awaiting-pr-merge": [],
    blocked: [],
    done: [],
  } as Record<WorkItemStatus, WorkItem[]>;

  for (const item of items) {
    grouped[item.status].push(item);
  }

  return grouped;
}

const RESTARTABLE_STATUSES = new Set<WorkItemStatus>([
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "blocked",
]);

export function canRestartWorkItemExecution(item: WorkItem | null): boolean {
  return item ? RESTARTABLE_STATUSES.has(item.status) : false;
}

export function getAllowedStatusTransitions(
  fromStatus: WorkItemStatus,
): WorkItemStatus[] {
  return KANBAN_COLUMNS.map((column) => column.status).filter(
    (status) => status !== fromStatus,
  );
}

export function getKanbanColumnTitle(status: WorkItemStatus): string {
  return (
    KANBAN_COLUMNS.find((column) => column.status === status)?.title ?? status
  );
}

export function deriveLiveState(item: WorkItem): WorkItemLiveState {
  const execStatus = item.lastExecutionStatus;

  if (execStatus === "FAILED" || execStatus === "CANCELLED") {
    return "error";
  }

  if (item.waitingForInput && execStatus === "RUNNING") {
    return "awaiting-input";
  }

  if (execStatus === "RUNNING") {
    return "running";
  }

  if (execStatus === "PENDING") {
    return "queued";
  }

  if (item.status === "done") {
    return "completed";
  }

  if (item.status === "blocked") {
    return "blocked";
  }

  if (execStatus === "COMPLETED") {
    return "completed";
  }

  return "idle";
}

export function validateWorkItemForm(
  data: WorkItemFormData,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.title.trim()) {
    errors.title = "Title is required.";
  }

  if (!data.priority) {
    errors.priority = "Priority is required.";
  }

  if (data.dependencyIds.length > 200) {
    errors.dependencyIds = "A work item can have at most 200 dependencies.";
  }

  if (data.type) {
    Object.assign(
      errors,
      validateWorkItemTypeFields({
        type: data.type,
        parentType: data.parentType,
        storyPoints: data.storyPoints,
      }),
    );
  }

  return errors;
}
