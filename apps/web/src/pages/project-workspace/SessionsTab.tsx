import { useMemo, useState } from "react";
import { useWorkItemRealtimeSubscription } from "@/hooks/useWorkItemRealtimeSubscription";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import * as KanbanContracts from "@nexus/kanban-contracts";
import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { deriveLiveState } from "@/pages/kanban/kanban.utils";

type WorkItemStatusGroups = {
  active: readonly WorkItemStatus[];
  completed: readonly WorkItemStatus[];
  blocked: readonly WorkItemStatus[];
};

const FALLBACK_WORK_ITEM_STATUS_GROUPS: WorkItemStatusGroups = {
  active: ["refinement", "in-progress", "in-review"],
  completed: ["ready-to-merge", "awaiting-pr-merge", "done"],
  blocked: ["blocked"],
};

function isStatusArray(value: unknown): value is readonly WorkItemStatus[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function resolveWorkItemStatusGroups(): WorkItemStatusGroups {
  const maybeGroups = (KanbanContracts as Record<string, unknown>)[
    "WORK_ITEM_STATUS_GROUPS"
  ];

  if (typeof maybeGroups !== "object" || maybeGroups === null) {
    return FALLBACK_WORK_ITEM_STATUS_GROUPS;
  }

  const record = maybeGroups as Record<string, unknown>;
  const active = record.active;
  const completed = record.completed;
  const blocked = record.blocked;

  if (
    !isStatusArray(active) ||
    !isStatusArray(completed) ||
    !isStatusArray(blocked)
  ) {
    return FALLBACK_WORK_ITEM_STATUS_GROUPS;
  }

  return {
    active,
    completed,
    blocked,
  };
}

interface SessionsTabProps {
  projectId: string;
}

type SessionFilter = "all" | "active" | "completed" | "blocked";

const SESSION_FILTERS: Array<{ value: SessionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
];

const WORK_ITEM_STATUS_GROUPS = resolveWorkItemStatusGroups();

const ACTIVE_STATUSES = new Set<WorkItemStatus>(WORK_ITEM_STATUS_GROUPS.active);
const COMPLETED_STATUSES = new Set<WorkItemStatus>(
  WORK_ITEM_STATUS_GROUPS.completed,
);
const BLOCKED_STATUSES = new Set<WorkItemStatus>(
  WORK_ITEM_STATUS_GROUPS.blocked,
);

function getStatusBadgeVariant(
  status: WorkItemStatus,
): "default" | "destructive" | "outline" {
  if (ACTIVE_STATUSES.has(status)) {
    return "default";
  }

  if (status === "blocked") {
    return "destructive";
  }

  return "outline";
}

interface FilterCounts {
  active: number;
  completed: number;
  blocked: number;
}

function calculateFilterCounts(workItems: WorkItem[]): FilterCounts {
  const items = workItems.filter((item) => !!item.currentExecutionId);
  return {
    active: items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
    completed: items.filter((item) => COMPLETED_STATUSES.has(item.status))
      .length,
    blocked: items.filter((item) => BLOCKED_STATUSES.has(item.status)).length,
  };
}

function getFilteredItems(
  workItems: WorkItem[],
  filter: SessionFilter,
): WorkItem[] {
  const sessionRelevantItems = workItems.filter(
    (item) => !!item.currentExecutionId,
  );

  switch (filter) {
    case "active":
      return sessionRelevantItems.filter((item) =>
        ACTIVE_STATUSES.has(item.status),
      );
    case "completed":
      return sessionRelevantItems.filter((item) =>
        COMPLETED_STATUSES.has(item.status),
      );
    case "blocked":
      return sessionRelevantItems.filter((item) =>
        BLOCKED_STATUSES.has(item.status),
      );
    default:
      return sessionRelevantItems;
  }
}

interface FilterButtonsProps {
  filter: SessionFilter;
  counts: FilterCounts;
  onChange: (filter: SessionFilter) => void;
}

function FilterButtons({
  filter,
  counts,
  onChange,
}: Readonly<FilterButtonsProps>) {
  return (
    <div className="flex items-center gap-2">
      {SESSION_FILTERS.map((f) => (
        <Button
          key={f.value}
          variant={filter === f.value ? "default" : "outline"}
          size="sm"
          onClick={() => {
            onChange(f.value);
          }}
        >
          {f.label}
          {f.value === "active" && counts.active > 0 && (
            <Badge variant="secondary" className="ml-1">
              {counts.active}
            </Badge>
          )}
          {f.value === "completed" && counts.completed > 0 && (
            <Badge variant="secondary" className="ml-1">
              {counts.completed}
            </Badge>
          )}
          {f.value === "blocked" && counts.blocked > 0 && (
            <Badge variant="destructive" className="ml-1">
              {counts.blocked}
            </Badge>
          )}
        </Button>
      ))}
    </div>
  );
}

interface SessionItemProps {
  item: WorkItem;
  projectId: string;
}

function SessionItem({ item, projectId }: Readonly<SessionItemProps>) {
  const liveState = deriveLiveState(item);

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{item.title}</p>
          <div className="flex items-center gap-2">
            <Badge variant={getStatusBadgeVariant(item.status)}>
              {item.status}
            </Badge>
            <Badge
              variant="secondary"
              className={liveState === "running" ? "animate-pulse" : ""}
            >
              {liveState}
            </Badge>
            {item.assignedAgentId && (
              <span className="text-xs text-muted-foreground">
                Agent: {item.assignedAgentId}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              Tokens: {item.tokenSpend ?? 0}
            </span>
          </div>
        </div>
        {item.currentExecutionId && (
          <Button variant="outline" size="sm" asChild>
            <Link
              to={`/projects/${projectId}/work-items/${item.id}/active-session`}
            >
              View Session
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface SessionsListProps {
  items: WorkItem[];
  projectId: string;
  hasContent: boolean;
  filter: SessionFilter;
}

function SessionsList({
  items,
  projectId,
  hasContent,
  filter,
}: Readonly<SessionsListProps>) {
  if (!hasContent) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? 'No execution sessions yet. Move a work item to "In Progress" to start an agent.'
              : `No ${filter} sessions found.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <SessionItem key={item.id} item={item} projectId={projectId} />
      ))}
    </div>
  );
}

export function SessionsTab({ projectId }: Readonly<SessionsTabProps>) {
  const [filter, setFilter] = useState<SessionFilter>("all");

  const { data: workItems = [] } = useProjectWorkItems(projectId);

  useWorkItemRealtimeSubscription(projectId);

  const filteredItems = useMemo(
    () => getFilteredItems(workItems, filter),
    [workItems, filter],
  );

  const counts = useMemo(() => calculateFilterCounts(workItems), [workItems]);

  return (
    <div className="space-y-4">
      <FilterButtons filter={filter} counts={counts} onChange={setFilter} />
      <SessionsList
        items={filteredItems}
        projectId={projectId}
        hasContent={filteredItems.length > 0}
        filter={filter}
      />
    </div>
  );
}
