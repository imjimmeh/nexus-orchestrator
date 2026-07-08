import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { useRetryChatSessionNow } from "./useChatSessions";

const apiMock = vi.hoisted(() => ({
  retryChatSessionNow: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useChatSessions", () => {
  it("invalidates all cached chat-session list variants after retrying now", async () => {
    const retriedSession: ChatSessionListItem = {
      id: "chat-session-1",
      sessionType: "general",
      status: "RUNNING",
      executionState: "running",
      retryMetadata: null,
      failureInfo: null,
      agentProfileName: "Assistant",
      projectId: null,
      projectName: null,
      displayName: "Retry test",
      initialMessage: "Retry this session",
      workflowRunId: null,
      createdAt: "2026-04-14T10:00:00.000Z",
      completedAt: null,
    };
    apiMock.retryChatSessionNow.mockResolvedValueOnce(retriedSession);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(queryKeys.chatSessions.list(), []);
    queryClient.setQueryData(
      queryKeys.chatSessions.list({ status: "retry_scheduled", limit: 25 }),
      [],
    );

    const { result } = renderHook(
      () => useRetryChatSessionNow("chat-session-1"),
      {
        wrapper: createWrapper(queryClient),
      },
    );

    const mutationResult = await act(async () => result.current.mutateAsync());

    expect(mutationResult).toEqual(retriedSession);
    expect(
      queryClient.getQueryState(queryKeys.chatSessions.list())?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        queryKeys.chatSessions.list({ status: "retry_scheduled", limit: 25 }),
      )?.isInvalidated,
    ).toBe(true);
  });
});
