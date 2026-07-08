import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { SessionThreadList } from "./SessionThreadList";

const useChatSessionsMock = vi.hoisted(() => vi.fn());
const useWorkflowRunsMock = vi.hoisted(() => vi.fn());
const useWorkflowsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useChatSessions", () => ({
  useChatSessions: useChatSessionsMock,
}));

vi.mock("@/hooks/useWorkflows", () => ({
  WORKFLOW_NAME_CATALOG_QUERY: { limit: 100, includeInactive: true },
  useWorkflowRuns: useWorkflowRunsMock,
  useWorkflowRun: vi.fn(),
  useWorkflows: useWorkflowsMock,
}));

const chatSessionsFixture: ChatSessionListItem[] = [
  {
    id: "chat-running",
    sessionType: "general",
    status: "RUNNING",
    executionState: "running",
    retryMetadata: null,
    failureInfo: null,
    agentProfileName: "architect",
    projectId: null,
    projectName: null,
    displayName: "Chat Running",
    initialMessage: "Investigate issue",
    workflowRunId: null,
    createdAt: "2026-04-11T10:30:00.000Z",
    completedAt: null,
  },
];

const workflowRunsFixture: WorkflowRun[] = [
  {
    id: "run-orchestrator-active",
    workflow_id: "wf-1",
    status: "RUNNING",
    current_step_id: null,
    state_variables: {
      trigger: {
        display_name: "Orchestrator Active",
      },
    },
    created_at: "2026-04-11T09:30:00.000Z",
    updated_at: "2026-04-11T09:31:00.000Z",
  },
  {
    id: "run-completed-unlinked",
    workflow_id: "wf-2",
    status: "COMPLETED",
    current_step_id: null,
    state_variables: {
      trigger: {
        display_name: "Completed Unlinked",
      },
    },
    created_at: "2026-04-10T09:30:00.000Z",
    updated_at: "2026-04-10T09:31:00.000Z",
    completed_at: "2026-04-10T09:35:00.000Z",
  },
];

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionThreadList
        selectedThreadId={null}
        onThreadSelect={vi.fn()}
        onThreadResolve={vi.fn()}
        unreadMap={new Map()}
      />
    </QueryClientProvider>,
  );
}

describe("SessionThreadList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T10:22:00.000Z"));

    useChatSessionsMock.mockReturnValue({
      data: {
        data: chatSessionsFixture,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    useWorkflowRunsMock.mockReturnValue({
      data: workflowRunsFixture,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    useWorkflowsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows workflow runs including completed entries", () => {
    renderWithProviders();

    expect(screen.getByText("Chat Running")).toBeTruthy();
    expect(screen.getByText("Orchestrator Active")).toBeTruthy();
    expect(screen.getByText("Completed Unlinked")).toBeTruthy();
  });

  it("renders workflow run display names from the API without a workflow catalog lookup", () => {
    useWorkflowRunsMock.mockReturnValue({
      data: [
        {
          ...workflowRunsFixture[1],
          state_variables: {},
          display_name: "Completed Workflow API Name",
          workflow_name: "Completed Workflow API Name",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders();

    expect(useWorkflowsMock).not.toHaveBeenCalled();
    expect(screen.getByText("Completed Workflow API Name")).toBeTruthy();
    expect(screen.queryByText(/Workflow run/)).toBeNull();
  });

  it("marks chat sessions waiting on provider rate limits as retry scheduled", () => {
    useChatSessionsMock.mockReturnValue({
      data: {
        data: [
          {
            ...chatSessionsFixture[0],
            id: "chat-retry",
            status: "RUNNING",
            executionState: "retry_scheduled",
            retryMetadata: {
              reasonCode: "provider_rate_limit_429",
              nextRetryAt: "2026-04-11T10:45:00.000Z",
              attempt: 2,
              maxAttempts: 4,
            },
            displayName: "Chat Waiting",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders();

    expect(screen.getByText("Chat Waiting")).toBeTruthy();
    expect(screen.getByText("Retry scheduled")).toBeTruthy();
    expect(screen.getByText("Rate limited - retrying in 23 min")).toBeTruthy();
  });

  it("shows any moment when the rate-limit retry time has elapsed", () => {
    useChatSessionsMock.mockReturnValue({
      data: {
        data: [
          {
            ...chatSessionsFixture[0],
            id: "chat-retry-elapsed",
            status: "RUNNING",
            executionState: "retry_scheduled",
            retryMetadata: {
              reasonCode: "provider_rate_limit_429",
              nextRetryAt: "2026-04-11T10:21:00.000Z",
            },
            displayName: "Chat Retry Due",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders();

    expect(screen.getByText("Chat Retry Due")).toBeTruthy();
    expect(screen.getByText("Rate limited - retrying any moment")).toBeTruthy();
  });

  it("polls chat sessions with a refetch interval to keep status live", () => {
    renderWithProviders();

    expect(useChatSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        refetchIntervalMs: expect.any(Number),
      }),
    );
  });

  it("shows subagent sessions nested under their parent session when they share a parentId", () => {
    useChatSessionsMock.mockReturnValue({
      data: {
        data: [
          {
            ...chatSessionsFixture[0],
            id: "parent-session",
            displayName: "Parent Chat",
            source: "ad-hoc",
            parentChatSessionId: null,
          },
          {
            ...chatSessionsFixture[0],
            id: "subagent-session",
            displayName: "Subagent Worker",
            status: "RUNNING" as const,
            source: "subagent",
            parentChatSessionId: "parent-session",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders();

    // Parent should be visible
    expect(screen.getByText("Parent Chat")).toBeTruthy();
    // Subagent should NOT appear at the top level (it should be collapsed under parent)
    // The subagent row should not be visible until parent is expanded
    expect(screen.queryByText("Subagent Worker")).toBeNull();
  });
});
