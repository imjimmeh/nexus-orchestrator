import { useMemo, useEffect, useState } from "react";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useWorkflowRuns } from "@/hooks/useWorkflows";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus } from "lucide-react";
import type { SessionThread } from "./session-thread.types";
import { resolveTriggerField } from "./triggerField.helpers";
import { ThreadListItem } from "./SessionThreadListItem";

type SourceFilter = "all" | "repository" | "non-repository";

const EMPTY_CHAT_SESSIONS: ChatSessionListItem[] = [];
const EMPTY_WORKFLOW_RUNS: WorkflowRun[] = [];

interface SessionThreadListProps {
  readonly selectedThreadId: string | null;
  readonly onThreadSelect: (thread: SessionThread) => void;
  readonly onThreadResolve: (thread: SessionThread | null) => void;
  readonly unreadMap: Map<string, boolean>;
  readonly onNewSession?: () => void;
}

function buildChatThread(session: ChatSessionListItem): SessionThread {
  const isSubagent = session.source === "subagent";
  return {
    id: session.id,
    kind: isSubagent ? "subagent" : "chat",
    title: session.displayName || "Untitled Chat",
    displayName: session.displayName || "Untitled Chat",
    initialMessage: session.initialMessage,
    status: session.status,
    executionState: session.executionState,
    retryMetadata: session.retryMetadata,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    lastActivityAt: session.completedAt || session.createdAt,
    projectName: session.projectName,
    agentProfileName: session.agentProfileName,
    parentId:
      session.parentChatSessionId ||
      (isSubagent ? session.workflowRunId : null),
  };
}

function buildWorkflowThread(run: WorkflowRun): SessionThread {
  const trigger = run.state_variables?.trigger as
    | Record<string, unknown>
    | undefined;
  const displayName =
    run.display_name ||
    resolveTriggerField(trigger, [
      "displayName",
      "display_name",
      "workflowName",
      "workflow_name",
    ]) ||
    run.workflow_name ||
    `Workflow run ${run.id.slice(0, 8)}`;

  return {
    id: run.id,
    kind: "workflow",
    title: displayName,
    displayName,
    status: run.status,
    createdAt: run.created_at,
    completedAt: run.completed_at ?? null,
    lastActivityAt: run.completed_at || run.created_at,
    workflowId: run.workflow_id,
    sourceType: run.source_type,
  };
}

function matchesSourceFilter(
  thread: SessionThread,
  filter: SourceFilter,
): boolean {
  if (thread.kind !== "workflow" || filter === "all") {
    return true;
  }

  if (filter === "repository") {
    return thread.sourceType === "repository";
  }

  return thread.sourceType !== "repository";
}

function extractWorkflowLinkedSessionId(run: WorkflowRun): string | null {
  const stateVariables = run.state_variables;
  if (!stateVariables || typeof stateVariables !== "object") {
    return null;
  }

  const candidate =
    stateVariables.chat_session_id ??
    stateVariables.chatSessionId ??
    stateVariables.session_id ??
    stateVariables.sessionId ??
    stateVariables.active_session_id ??
    stateVariables.activeSessionId;

  if (typeof candidate !== "string") {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function shouldIncludeWorkflowThread(_run: WorkflowRun): boolean {
  const includedStatuses = new Set([
    "RUNNING",
    "PENDING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);

  return (
    extractWorkflowLinkedSessionId(_run) !== null ||
    includedStatuses.has(_run.status)
  );
}

function processSessionThreads(
  chatListRaw: ChatSessionListItem[],
  workflowListRaw: WorkflowRun[],
  sourceFilter: SourceFilter,
) {
  const chatList = chatListRaw.map(buildChatThread);
  const workflowList = workflowListRaw
    .filter(shouldIncludeWorkflowThread)
    .map(buildWorkflowThread)
    .filter((thread) => matchesSourceFilter(thread, sourceFilter));

  // Separate subagent sessions from top-level sessions
  const subagents = chatList.filter(
    (t: SessionThread) => t.kind === "subagent" && t.parentId,
  );
  const topLevel = [
    ...chatList.filter(
      (t: SessionThread) => t.kind !== "subagent" || !t.parentId,
    ),
    ...workflowList,
  ];

  // Build a lookup map: parentId -> subagent threads
  const subagentMap = new Map<string, SessionThread[]>();
  for (const sub of subagents) {
    if (sub.parentId) {
      const existing = subagentMap.get(sub.parentId) ?? [];
      existing.push(sub);
      subagentMap.set(sub.parentId, existing);
    }
  }

  const sorted = [...topLevel].sort((a, b) => {
    const aTime = new Date(a.lastActivityAt || "").getTime();
    const bTime = new Date(b.lastActivityAt || "").getTime();
    return bTime - aTime;
  });

  return { threads: sorted, subagentsByParentId: subagentMap };
}

function useSessionThreadSources(debouncedSearch: string, limit: number) {
  const chatSessions = useChatSessions({
    status: "RUNNING,STARTING,COMPLETED,FAILED,CANCELLED",
    search: debouncedSearch || undefined,
    limit,
    offset: 0,
    refetchIntervalMs: 3000,
  });

  const workflowRuns = useWorkflowRuns({
    status: "RUNNING,PENDING,COMPLETED,FAILED,CANCELLED",
    search: debouncedSearch || undefined,
    limit,
    offset: 0,
  });

  return {
    chatList: chatSessions.data?.data ?? EMPTY_CHAT_SESSIONS,
    workflowList: workflowRuns.data ?? EMPTY_WORKFLOW_RUNS,
    chatTotal: chatSessions.data?.meta?.pagination?.total,
    isLoading: chatSessions.isLoading || workflowRuns.isLoading,
    listErrorMessage: getSessionThreadListErrorMessage(
      chatSessions,
      workflowRuns,
    ),
    refetchThreads: () => {
      chatSessions.refetch().catch(() => {});
      workflowRuns.refetch().catch(() => {});
    },
  };
}

function getSessionThreadListErrorMessage(
  chatSessions: ReturnType<typeof useChatSessions>,
  workflowRuns: ReturnType<typeof useWorkflowRuns>,
): string {
  return [
    chatSessions.isError
      ? getApiErrorMessage(chatSessions.error, "Unable to load chat sessions.")
      : null,
    workflowRuns.isError
      ? getApiErrorMessage(workflowRuns.error, "Unable to load workflow runs.")
      : null,
  ]
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function hasMoreSessionThreads({
  chatCount,
  chatTotal,
  workflowCount,
  limit,
}: Readonly<{
  chatCount: number;
  chatTotal: number | undefined;
  workflowCount: number;
  limit: number;
}>): boolean {
  const hasMoreChats =
    typeof chatTotal === "number" ? chatTotal > chatCount : chatCount >= limit;
  return hasMoreChats || workflowCount >= limit;
}

function SessionThreadListHeader({
  onNewSession,
  search,
  onSearchChange,
  sourceFilter,
  onSourceFilterChange,
}: Readonly<{
  onNewSession?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (value: SourceFilter) => void;
}>) {
  return (
    <div className="border-b p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Chats & Runs</h2>
        {onNewSession ? (
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={onNewSession}
          >
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
        ) : null}
      </div>
      <Input
        placeholder="Search..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-8 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Run source</span>
        <select
          aria-label="Run source"
          value={sourceFilter}
          onChange={(event) =>
            onSourceFilterChange(event.target.value as SourceFilter)
          }
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All runs</option>
          <option value="repository">Repository runs</option>
          <option value="non-repository">Non-repository runs</option>
        </select>
      </label>
    </div>
  );
}

export function SessionThreadList({
  selectedThreadId,
  onThreadSelect,
  onThreadResolve,
  unreadMap,
  onNewSession,
}: SessionThreadListProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    setLimit(100);
  }, [debouncedSearch, sourceFilter]);

  const {
    chatList,
    workflowList,
    chatTotal,
    isLoading,
    listErrorMessage,
    refetchThreads,
  } = useSessionThreadSources(debouncedSearch, limit);

  // Merge and sort threads by last activity
  const { threads, subagentsByParentId } = useMemo(() => {
    return processSessionThreads(chatList, workflowList, sourceFilter);
  }, [chatList, sourceFilter, workflowList]);

  // Flat list including subagents (needed for selectedThreadId resolution)
  const allThreads = useMemo(() => {
    const subagentFlat = Array.from(subagentsByParentId.values()).flat();
    return [...threads, ...subagentFlat];
  }, [threads, subagentsByParentId]);

  const onRetry = () => {
    refetchThreads();
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useSelectedThreadResolver(
    isLoading,
    selectedThreadId,
    allThreads,
    onThreadResolve,
    setExpandedIds,
  );

  const hasMore = hasMoreSessionThreads({
    chatCount: chatList.length,
    chatTotal,
    workflowCount: workflowList.length,
    limit,
  });

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isNearBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    if (isNearBottom && hasMore && !isLoading) {
      setLimit((prev) => prev + 100);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <SessionThreadListHeader
        onNewSession={onNewSession}
        search={search}
        onSearchChange={setSearch}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
      />

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        <SessionThreadListContent
          isLoading={isLoading}
          listErrorMessage={listErrorMessage}
          threads={threads}
          selectedThreadId={selectedThreadId}
          unreadMap={unreadMap}
          subagentsByParentId={subagentsByParentId}
          expandedIds={expandedIds}
          onThreadSelect={onThreadSelect}
          toggleExpand={toggleExpand}
          onRetry={onRetry}
        />
        {isLoading && threads.length > 0 && (
          <div className="text-xs text-muted-foreground text-center p-2">
            Loading more...
          </div>
        )}
      </div>
    </div>
  );
}

function SessionThreadListContent({
  isLoading,
  listErrorMessage,
  threads,
  selectedThreadId,
  unreadMap,
  subagentsByParentId,
  expandedIds,
  onThreadSelect,
  toggleExpand,
  onRetry,
}: Readonly<{
  isLoading: boolean;
  listErrorMessage: string;
  threads: SessionThread[];
  selectedThreadId: string | null;
  unreadMap: Map<string, boolean>;
  subagentsByParentId: Map<string, SessionThread[]>;
  expandedIds: Set<string>;
  onThreadSelect: (thread: SessionThread) => void;
  toggleExpand: (id: string, e: React.MouseEvent) => void;
  onRetry: () => void;
}>) {
  if (listErrorMessage) {
    return (
      <div className="p-3">
        <Alert variant="destructive">
          <AlertTitle>Unable To Load Sessions</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{listErrorMessage}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onRetry();
              }}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading && threads.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isLoading && threads.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No chats or runs yet
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {threads.map((thread) => (
        <div key={thread.id}>
          <ThreadListItem
            thread={thread}
            selected={selectedThreadId === thread.id}
            unread={unreadMap.get(thread.id) ?? false}
            onSelect={() => {
              onThreadSelect(thread);
            }}
            hasChildren={subagentsByParentId.has(thread.id)}
            isExpanded={expandedIds.has(thread.id)}
            onToggleExpand={(e) => toggleExpand(thread.id, e)}
          />
          {expandedIds.has(thread.id) && subagentsByParentId.has(thread.id) && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-1">
              {(subagentsByParentId.get(thread.id) ?? []).map((child) => (
                <ThreadListItem
                  key={child.id}
                  thread={child}
                  selected={selectedThreadId === child.id}
                  unread={unreadMap.get(child.id) ?? false}
                  onSelect={() => {
                    onThreadSelect(child);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

function useSelectedThreadResolver(
  isLoading: boolean,
  selectedThreadId: string | null,
  allThreads: SessionThread[],
  onThreadResolve: (thread: SessionThread | null) => void,
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!selectedThreadId) {
      onThreadResolve(null);
      return;
    }

    const thread = allThreads.find(
      (candidate) => candidate.id === selectedThreadId,
    );

    // Auto-expand parent if a child is selected
    const parentId = thread?.parentId;
    if (parentId) {
      setExpandedIds((prev) => {
        if (prev.has(parentId)) {
          return prev;
        }
        return new Set(prev).add(parentId);
      });
    }

    onThreadResolve(thread ?? null);
  }, [
    isLoading,
    onThreadResolve,
    selectedThreadId,
    allThreads,
    setExpandedIds,
  ]);
}
