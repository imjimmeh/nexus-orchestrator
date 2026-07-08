import { useMemo, useState, useEffect, useCallback } from "react";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useWorkflowRuns } from "@/hooks/useWorkflows";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import {
  buildChatItems,
  buildWorkflowItems,
  useUnreadThreadState,
} from "@/pages/sessions/SessionsListPage.helpers";
import { toListFromArray } from "@/pages/sessions/SessionsListPage.helpers";

const CHAT_STATUSES = "RUNNING,STARTING,COMPLETED,FAILED,CANCELLED";
const WORKFLOW_STATUSES = "RUNNING,PENDING,COMPLETED,FAILED,CANCELLED";

function getPaginatedItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as { data?: unknown };
  return Array.isArray(candidate.data) ? (candidate.data as T[]) : [];
}

export function useSessionsList(options: {
  search?: string;
  sessionTypeFilter: string;
  selectedKey: string | null;
}) {
  const { search, sessionTypeFilter, selectedKey } = options;
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    setLimit(100);
  }, [search, sessionTypeFilter]);

  const chatSessions = useChatSessions({
    search: search || undefined,
    status: CHAT_STATUSES,
    limit,
    offset: 0,
    refetchIntervalMs: 3000,
  });

  const workflowRuns = useWorkflowRuns({
    search: search || undefined,
    status: WORKFLOW_STATUSES,
    limit,
    offset: 0,
    refetchIntervalMs: 3000,
  });

  const threads = useMemo(() => {
    const chatList = getPaginatedItems<ChatSessionListItem>(chatSessions.data);
    const workflowList = getPaginatedItems<WorkflowRun>(workflowRuns.data);

    const chatItems = buildChatItems(toListFromArray(chatList));
    const workflowItems = buildWorkflowItems(toListFromArray(workflowList));
    const items = [...chatItems, ...workflowItems];

    const filtered =
      sessionTypeFilter === "all"
        ? items
        : items.filter((item) => item.sessionType === sessionTypeFilter);

    return filtered.sort(
      (a, b) =>
        new Date(b.lastActivityAt || b.createdAt).getTime() -
        new Date(a.lastActivityAt || a.createdAt).getTime(),
    );
  }, [chatSessions.data, workflowRuns.data, sessionTypeFilter]);

  const selectedThread = useMemo(() => {
    if (!selectedKey) return null;
    const [kind, id] = selectedKey.split(":");
    return threads.find((t) => t.kind === kind && t.id === id) ?? null;
  }, [threads, selectedKey]);

  const error = [
    chatSessions.isError
      ? getApiErrorMessage(chatSessions.error, "Unable to load chat sessions.")
      : null,
    workflowRuns.isError
      ? getApiErrorMessage(workflowRuns.error, "Unable to load workflow runs.")
      : null,
  ]
    .filter((e): e is string => Boolean(e))
    .join(" ");

  const unreadMap = useUnreadThreadState(threads, selectedKey);

  const chatList = getPaginatedItems<ChatSessionListItem>(chatSessions.data);
  const workflowList = getPaginatedItems<WorkflowRun>(workflowRuns.data);

  const hasMoreChats = chatSessions.data?.meta?.pagination
    ? (chatSessions.data.meta.pagination.total ?? 0) > chatList.length
    : chatList.length >= limit;
  const hasMoreWorkflows = workflowList.length >= limit;
  const hasMore = hasMoreChats || hasMoreWorkflows;

  const loadMore = useCallback(() => {
    if (hasMore && !chatSessions.isLoading && !workflowRuns.isLoading) {
      setLimit((prev) => prev + 100);
    }
  }, [hasMore, chatSessions.isLoading, workflowRuns.isLoading]);

  return {
    threads,
    selectedThread,
    error,
    unreadMap,
    loading: chatSessions.isLoading || workflowRuns.isLoading,
    hasMore,
    loadMore,
    refetch: () => {
      void chatSessions.refetch();
      void workflowRuns.refetch();
    },
  };
}
