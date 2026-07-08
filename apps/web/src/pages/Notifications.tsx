import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Check, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNotifications } from "@/hooks/useNotifications";
import { api } from "@/lib/api/client";
import { formatDateSafe } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";
import type { InboxNotification } from "@/lib/notifications/inboxNotification.types";

function getMetadataString(
  metadata: InboxNotification["metadata"],
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getProjectOrchestrationPath(projectId: string): string {
  return `/projects/${projectId}?tab=orchestration`;
}

function resolveWaitingInputDestination(
  projectId: string | null,
  workflowRunId: string | null,
): string | null {
  if (projectId && workflowRunId) {
    return `/projects/${projectId}/runs/${workflowRunId}/active-session`;
  }

  return projectId ? getProjectOrchestrationPath(projectId) : null;
}

function resolveApprovalDestination(projectId: string | null): string | null {
  return projectId ? getProjectOrchestrationPath(projectId) : null;
}

async function resolveWorkflowFailureDestination(
  projectId: string | null,
  workflowRunId: string | null,
): Promise<string | null> {
  if (workflowRunId) {
    try {
      const run = await api.getWorkflowRun(workflowRunId);
      if (run?.workflow_id && run?.id) {
        return `/workflows/${run.workflow_id}/runs/${run.id}`;
      }
    } catch {
      // Fall back to the project orchestration view when run detail resolution fails.
    }
  }

  return projectId ? getProjectOrchestrationPath(projectId) : null;
}

// --- Deliverable 5: Declarative notification routing and icons ---

type NotificationDestinationResolver = (
  meta: NotificationMetadata,
) => Promise<string | null> | string | null;

interface NotificationMetadata {
  projectId: string | null;
  workflowRunId: string | null;
}

function resolveDefaultDestination(projectId: string | null): string | null {
  return projectId ? `/projects/${projectId}` : null;
}

const NOTIFICATION_DESTINATION_RESOLVERS: Record<
  string,
  NotificationDestinationResolver
> = {
  "work_item.waiting_input": ({ projectId, workflowRunId }) =>
    resolveWaitingInputDestination(projectId, workflowRunId),
  "workflow.user_input.required": ({ projectId, workflowRunId }) =>
    resolveWaitingInputDestination(projectId, workflowRunId),
  "orchestration_action.pending": ({ projectId }) =>
    resolveApprovalDestination(projectId),
  "tool_call.approval_needed": ({ projectId }) =>
    resolveApprovalDestination(projectId),
  "workflow.run.failed": ({ projectId, workflowRunId }) =>
    resolveWorkflowFailureDestination(projectId, workflowRunId),
  "workflow.job.error": ({ projectId, workflowRunId }) =>
    resolveWorkflowFailureDestination(projectId, workflowRunId),
  "work_item.blocked": ({ projectId }) =>
    projectId ? `/projects/${projectId}` : null,
  "work_item.ready_for_review": ({ projectId }) =>
    projectId ? `/projects/${projectId}` : null,
  "work_item.ready_to_merge": ({ projectId }) =>
    projectId ? `/projects/${projectId}` : null,
  "workflow.repair.warning": ({ projectId, workflowRunId }) =>
    resolveWorkflowFailureDestination(projectId, workflowRunId),
};

const EVENT_ICONS: Record<string, ReactNode> = {
  "workflow.run.failed": <AlertTriangle className="h-5 w-5 text-destructive" />,
  "workflow.job.error": <AlertTriangle className="h-5 w-5 text-destructive" />,
  "orchestration_action.pending": (
    <MessageSquare className="h-5 w-5 text-primary" />
  ),
  "tool_call.approval_needed": (
    <MessageSquare className="h-5 w-5 text-primary" />
  ),
  "work_item.waiting_input": <MessageSquare className="h-5 w-5 text-primary" />,
  "workflow.user_input.required": (
    <MessageSquare className="h-5 w-5 text-primary" />
  ),
  "work_item.blocked": <AlertTriangle className="h-5 w-5 text-destructive" />,
  "work_item.ready_for_review": (
    <MessageSquare className="h-5 w-5 text-primary" />
  ),
  "work_item.ready_to_merge": (
    <MessageSquare className="h-5 w-5 text-primary" />
  ),
  "workflow.repair.warning": <AlertTriangle className="h-5 w-5 text-warning" />,
};

function getEventIcon(eventType: string): ReactNode {
  return (
    EVENT_ICONS[eventType] ?? <Bell className="h-5 w-5 text-muted-foreground" />
  );
}

async function resolveNotificationDestination(
  notification: InboxNotification,
): Promise<string | null> {
  const meta: NotificationMetadata = {
    projectId:
      getMetadataString(notification.metadata, "projectId") ??
      getMetadataString(notification.metadata, "scopeId"),
    workflowRunId: getMetadataString(notification.metadata, "workflowRunId"),
  };
  const resolver =
    NOTIFICATION_DESTINATION_RESOLVERS[notification.eventType] ??
    (({ projectId }: NotificationMetadata) =>
      resolveDefaultDestination(projectId));
  return resolver(meta);
}

interface NotificationCardProps {
  readonly notification: InboxNotification;
  readonly onClick: () => void;
}

function NotificationCard({
  notification,
  onClick,
}: Readonly<NotificationCardProps>) {
  const isUnread = !notification.readAt;

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/50 ${isUnread ? "border-l-4 border-l-primary" : ""}`}
      onClick={onClick}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5">{getEventIcon(notification.eventType)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className={`text-sm font-medium ${isUnread ? "text-foreground" : "text-muted-foreground"}`}
            >
              {notification.subject}
            </h3>
            {isUnread ? (
              <div className="h-2 w-2 rounded-full bg-primary" />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {notification.body}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatDateSafe(
              notification.createdAt,
              "MMM d, yyyy HH:mm:ss",
              "Unknown",
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Not wired to the active app scope (Phase 5 Task 8): the in-app inbox is
// purely per-user (NotificationInboxController#getInbox resolves userId from
// the JWT and has no scopeNodeId query param), so there is no scope-aware
// list endpoint to forward the active scope to.
export function Notifications() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    total,
    markRead,
    markAllRead,
    isLoading,
  } = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  const filteredNotifications = notifications.filter((notification) => {
    if (filter === "unread") {
      return !notification.readAt;
    }
    if (filter === "read") {
      return Boolean(notification.readAt);
    }
    return true;
  });

  const handleNotificationClick = async (notification: InboxNotification) => {
    if (!notification.readAt) {
      markRead.mutate(notification.id);
    }

    const destination = await resolveNotificationDestination(notification);
    if (destination) {
      navigate(destination);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {[1, 2, 3].map((value) => (
            <div key={value} className="h-20 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bell className="h-6 w-6" />
            Notifications
            {unreadCount > 0 ? (
              <Badge variant="destructive">{unreadCount} unread</Badge>
            ) : null}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {total} total notification{total === 1 ? "" : "s"}
          </p>
        </div>

        {unreadCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              markAllRead.mutate();
            }}
            disabled={markAllRead.isPending}
          >
            <Check className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-2">
        {(["all", "unread", "read"] as const).map((value) => {
          return (
            <Button
              key={value}
              variant={filter === value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setFilter(value);
              }}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
              {value === "unread" && unreadCount > 0 ? ` (${unreadCount})` : ""}
            </Button>
          );
        })}
      </div>

      <ErrorBoundary>
        <div className="space-y-2">
          {filteredNotifications.map((notification) => {
            return (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onClick={() => {
                  void handleNotificationClick(notification);
                }}
              />
            );
          })}

          {filteredNotifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">No notifications</p>
              <p className="text-muted-foreground">
                {filter === "unread"
                  ? "You have no unread notifications."
                  : "You have no notifications yet."}
              </p>
            </div>
          ) : null}
        </div>
      </ErrorBoundary>
    </div>
  );
}
