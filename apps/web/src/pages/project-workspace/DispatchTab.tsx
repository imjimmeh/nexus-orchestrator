import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { asRecord } from "@/lib/deep-paths";
import { api } from "@/lib/api/client";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import { ProjectOrchestrationActionRequest, ProjectOrchestrationDecisionEntry } from "@/lib/api/projects.types";
import { WorkItem } from "@/lib/api/work-items.types";
import { formatDateSafe, getDateSortValue } from "@/lib/utils";

interface DispatchTabProps {
  readonly projectId: string;
}

interface DispatchDecisionViewModel {
  decision: ProjectOrchestrationDecisionEntry;
  title: string;
}

interface PendingDispatchRequestViewModel {
  request: ProjectOrchestrationActionRequest;
  workItems: WorkItem[];
  unresolvedIds: string[];
}

const DISPATCH_ACTION_NAME = "dispatch_start_work_items";

function getDecisionStatusVariant(
  status: ProjectOrchestrationDecisionEntry["executionStatus"] | undefined,
) {
  switch (status) {
    case "executed":
      return "default" as const;
    case "queued_for_approval":
      return "secondary" as const;
    case "denied":
      return "outline" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function normalizeWorkItemIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string");
  }

  if (typeof raw !== "string") {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  } catch {
    return [trimmed];
  }

  return [trimmed];
}

function isDispatchDecision(entry: ProjectOrchestrationDecisionEntry): boolean {
  if (entry.requestedAction === DISPATCH_ACTION_NAME) {
    return true;
  }

  return entry.actions.some((action) => action === DISPATCH_ACTION_NAME);
}

function getDispatchDecisionTitle(
  entry: ProjectOrchestrationDecisionEntry,
): string {
  if (entry.executionStatus === "queued_for_approval") {
    return "Dispatch Queued For Approval";
  }

  if (entry.executionStatus === "failed") {
    return "Dispatch Attempt Failed";
  }

  if (entry.executionStatus === "executed") {
    return "Dispatch Executed";
  }

  if (entry.executionStatus === "denied") {
    return "Dispatch Denied";
  }

  return "Dispatch Decision";
}

function DispatchDecisionCard(props: {
  decision: ProjectOrchestrationDecisionEntry;
  title: string;
}) {
  const { decision, title } = props;

  return (
    <Card key={`${decision.timestamp}-${decision.correlationId ?? title}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Recorded{" "}
              {formatDateSafe(
                decision.timestamp,
                "MMM d, yyyy HH:mm:ss",
                "Unknown",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getDecisionStatusVariant(decision.executionStatus)}>
              {decision.executionStatus ?? "unknown"}
            </Badge>
            {decision.modeEvaluation ? (
              <Badge variant="secondary">mode: {decision.modeEvaluation}</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Decision Type</p>
            <p>{decision.type}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Correlation</p>
            <p className="font-mono text-xs">{decision.correlationId ?? "-"}</p>
          </div>
        </div>

        <p className="rounded-md border p-3 text-sm whitespace-pre-wrap">
          {decision.reasoning}
        </p>
      </CardContent>
    </Card>
  );
}

function PendingDispatchRequestCard(props: {
  projectId: string;
  request: ProjectOrchestrationActionRequest;
  workItems: WorkItem[];
  unresolvedIds: string[];
}) {
  const { projectId, request, workItems, unresolvedIds } = props;

  return (
    <Card key={request.id}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Pending Dispatch Approval
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Requested{" "}
              {formatDateSafe(
                request.created_at,
                "MMM d, yyyy HH:mm:ss",
                "Unknown",
              )}
            </p>
          </div>
          <Badge variant="secondary">{request.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Requested By</p>
            <p>{request.requestedBy || "automation"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Correlation</p>
            <p className="font-mono text-xs">{request.correlationId}</p>
          </div>
        </div>

        {workItems.length > 0 ? (
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Selected Work Items</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {workItems.map((workItem) => (
                <div
                  key={workItem.id}
                  className="flex items-center gap-2 rounded border px-2 py-1"
                >
                  <span className="font-mono text-xs">{workItem.id}</span>
                  <span className="text-sm">{workItem.title}</span>
                  <Badge variant="outline">{workItem.priority}</Badge>
                  <Badge variant="secondary">{workItem.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {unresolvedIds.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Missing from current board: {unresolvedIds.join(", ")}
          </p>
        ) : null}

        <Button asChild size="sm" variant="outline">
          <Link to={`/projects/${projectId}?tab=orchestration`}>
            Review In Orchestration Tab
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function DispatchTab({ projectId }: Readonly<DispatchTabProps>) {
  const { data: orchestrationState, isLoading: isLoadingOrchestration } =
    useQuery({
      queryKey: ["project-orchestration", projectId, "state"],
      queryFn: () => api.getProjectOrchestrationState(projectId),
      enabled: !!projectId,
      refetchInterval: 10_000,
    });

  const orchestration = orchestrationState?.orchestration ?? null;
  const pendingActionRequests = orchestrationState?.pendingActionRequests ?? [];

  const { data: workItems = [], isLoading: isLoadingWorkItems } = useProjectWorkItems(
    projectId,
    { refetchInterval: 10_000 },
  );

  const dispatchDecisions = useMemo<DispatchDecisionViewModel[]>(() => {
    const decisions = orchestration?.decisionLog ?? [];
    return decisions
      .filter((entry) => isDispatchDecision(entry))
      .sort(
        (left, right) =>
          getDateSortValue(right.timestamp) - getDateSortValue(left.timestamp),
      )
      .map((decision) => ({
        decision,
        title: getDispatchDecisionTitle(decision),
      }));
  }, [orchestration?.decisionLog]);

  const pendingDispatchRequests = useMemo<
    PendingDispatchRequestViewModel[]
  >(() => {
    const workItemById = new Map(workItems.map((item) => [item.id, item]));

    return pendingActionRequests
      .filter((request) => request.action === DISPATCH_ACTION_NAME)
      .sort(
        (left, right) =>
          getDateSortValue(right.created_at) -
          getDateSortValue(left.created_at),
      )
      .map((request) => {
        const payload = asRecord(request.payload);
        const workItemIds = normalizeWorkItemIds(payload?.work_item_ids);
        const workItemsForRequest: WorkItem[] = [];
        const unresolvedIds: string[] = [];

        for (const id of workItemIds) {
          const workItem = workItemById.get(id);
          if (workItem) {
            workItemsForRequest.push(workItem);
          } else {
            unresolvedIds.push(id);
          }
        }

        return {
          request,
          workItems: workItemsForRequest,
          unresolvedIds,
        };
      });
  }, [pendingActionRequests, workItems]);

  const failedCount = dispatchDecisions.filter(
    (entry) => entry.decision.executionStatus === "failed",
  ).length;

  if (isLoadingOrchestration || isLoadingWorkItems) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Loading dispatch activity...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (dispatchDecisions.length === 0 && pendingDispatchRequests.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            No dispatch decisions recorded for this project yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Decisions {dispatchDecisions.length}</Badge>
        <Badge variant="outline">
          Pending approvals {pendingDispatchRequests.length}
        </Badge>
        <Badge variant={failedCount > 0 ? "destructive" : "outline"}>
          Failed attempts {failedCount}
        </Badge>
      </div>

      <div className="space-y-3">
        {dispatchDecisions.map(({ decision, title }) => (
          <DispatchDecisionCard
            key={`${decision.timestamp}-${decision.correlationId ?? title}`}
            decision={decision}
            title={title}
          />
        ))}

        {pendingDispatchRequests.map(
          ({ request, workItems, unresolvedIds }) => (
            <PendingDispatchRequestCard
              key={request.id}
              projectId={projectId}
              request={request}
              workItems={workItems}
              unresolvedIds={unresolvedIds}
            />
          ),
        )}
      </div>
    </div>
  );
}
