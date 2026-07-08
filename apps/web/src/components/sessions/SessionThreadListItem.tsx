import type { MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionThread } from "./session-thread.types";
import { SessionStatusBadge } from "./SessionStatusBadge";

function isRateLimitRetry(session: {
  executionState?: string;
  retryMetadata?: { reasonCode?: string } | null;
}): boolean {
  return (
    session.executionState === "retry_scheduled" &&
    session.retryMetadata?.reasonCode === "provider_rate_limit_429"
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatRetryCountdown(nextRetryAt: string, now = new Date()): string {
  const diffMs = new Date(nextRetryAt).getTime() - now.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "any moment";
  const minutes = Math.ceil(diffMs / 60000);
  return minutes === 1 ? "in 1 min" : `in ${minutes} min`;
}

function getRateLimitRetrySubtitle(thread: SessionThread): string {
  const nextRetryAt = thread.retryMetadata?.nextRetryAt;
  if (!nextRetryAt) {
    return "Rate limit retry pending";
  }

  return `Rate limited - retrying ${formatRetryCountdown(nextRetryAt)}`;
}

function isThreadActive(
  thread: SessionThread,
  isWaitingOnRateLimit: boolean,
): boolean {
  if (isWaitingOnRateLimit) return false;
  const activeStatuses =
    thread.kind === "chat" || thread.kind === "subagent"
      ? ["RUNNING", "STARTING"]
      : ["RUNNING", "PENDING"];
  return activeStatuses.includes(thread.status);
}

function ThreadExpandControl({
  hasChildren,
  isExpanded,
  onToggleExpand,
}: Readonly<{
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: MouseEvent) => void;
}>) {
  if (!hasChildren || !onToggleExpand) return <div className="w-4" />;
  return (
    <button
      type="button"
      onClick={onToggleExpand}
      className="p-0.5 hover:bg-muted rounded-sm cursor-pointer"
      aria-label={isExpanded ? "Collapse subagents" : "Expand subagents"}
    >
      {isExpanded ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
    </button>
  );
}

function ThreadKindBadge({ kind }: Readonly<{ kind: SessionThread["kind"] }>) {
  if (kind === "workflow") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] h-4 px-1 shrink-0 uppercase tracking-tight"
      >
        workflow
      </Badge>
    );
  }
  if (kind === "subagent") {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] h-4 px-1 shrink-0 uppercase tracking-tight"
      >
        subagent
      </Badge>
    );
  }
  return null;
}

function SourceTypeBadge({
  sourceType,
}: Readonly<{ sourceType?: SessionThread["sourceType"] }>) {
  if (sourceType !== "repository") {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      className="text-[10px] h-4 px-1 shrink-0 uppercase tracking-tight"
    >
      repo
    </Badge>
  );
}

function ThreadStatusLine({
  thread,
  isWaitingOnRateLimit,
}: Readonly<{
  thread: SessionThread;
  isWaitingOnRateLimit: boolean;
}>) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      {isWaitingOnRateLimit ? (
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] h-4 px-1 py-0 uppercase tracking-tight",
            "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          Retry scheduled
        </Badge>
      ) : (
        <SessionStatusBadge kind={thread.kind} status={thread.status} />
      )}
      {isWaitingOnRateLimit && (
        <span className="text-amber-700 dark:text-amber-300 truncate">
          {getRateLimitRetrySubtitle(thread)}
        </span>
      )}
      <span className="shrink-0 ml-auto opacity-70">
        {formatTime(thread.lastActivityAt || "")}
      </span>
    </div>
  );
}

export function ThreadListItem({
  thread,
  selected,
  unread,
  onSelect,
  hasChildren,
  isExpanded,
  onToggleExpand,
}: Readonly<{
  thread: SessionThread;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: MouseEvent) => void;
}>) {
  const isWaitingOnRateLimit =
    (thread.kind === "chat" || thread.kind === "subagent") &&
    isRateLimitRetry(thread);
  const isActive = isThreadActive(thread, isWaitingOnRateLimit);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "w-full flex items-start gap-2 border-0 px-2 py-3 rounded-md text-left relative cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
        selected && "bg-primary/10 hover:bg-primary/15",
      )}
    >
      <div className="flex items-center self-start mt-1">
        <ThreadExpandControl
          hasChildren={hasChildren}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {unread && (
            <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
          )}
          <span className="font-medium truncate text-sm">{thread.title}</span>
          <ThreadKindBadge kind={thread.kind} />
          <SourceTypeBadge sourceType={thread.sourceType} />
        </div>
        <ThreadStatusLine
          thread={thread}
          isWaitingOnRateLimit={isWaitingOnRateLimit}
        />
      </div>
      {isActive && (
        <div className="h-2 w-2 rounded-full bg-success shrink-0 self-center" />
      )}
    </div>
  );
}
