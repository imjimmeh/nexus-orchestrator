import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionConversationPane } from "./SessionConversationPane";

const useChatSessionMock = vi.hoisted(() => vi.fn());
const useChatSessionTelemetryMock = vi.hoisted(() => vi.fn());
const useWorkflowRunMock = vi.hoisted(() => vi.fn());
const useWorkflowsMock = vi.hoisted(() => vi.fn());
const useWorkflowRunTelemetryMock = vi.hoisted(() => vi.fn());
const useActiveSessionWorkspaceActionsMock = vi.hoisted(() => vi.fn());
const useWorkspaceDerivedStateMock = vi.hoisted(() => vi.fn());

Object.defineProperty(Element.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

vi.mock("@/hooks/useChatSessions", () => ({
  useChatSession: useChatSessionMock,
  useRetryChatSessionNow: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/useChatSessionTelemetry", () => ({
  useChatSessionTelemetry: useChatSessionTelemetryMock,
}));

vi.mock("@/hooks/useWorkflows", () => ({
  WORKFLOW_NAME_CATALOG_QUERY: { limit: 100, includeInactive: true },
  useWorkflowRun: useWorkflowRunMock,
  useWorkflows: useWorkflowsMock,
}));

vi.mock("@/hooks/useWorkflowRunTelemetry", () => ({
  useWorkflowRunTelemetry: useWorkflowRunTelemetryMock,
}));

vi.mock("@/pages/active-session/ActiveSessionWorkspace.actions", () => ({
  useActiveSessionWorkspaceActions: useActiveSessionWorkspaceActionsMock,
  useWorkspaceArtifacts: vi.fn(),
}));

vi.mock("@/pages/active-session/active-session.workspace.helpers", () => ({
  useWorkspaceDerivedState: useWorkspaceDerivedStateMock,
}));

function renderPane(options: { kind?: "chat" | "workflow" } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SessionConversationPane
          threadId={options.kind === "workflow" ? "run-1" : "chat-1"}
          kind={options.kind ?? "chat"}
          onShowExecution={vi.fn()}
          onMarkAsRead={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SessionConversationPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a rate-limit retry banner and disables chat input", () => {
    useChatSessionMock.mockReturnValue({
      data: {
        id: "chat-1",
        status: "RUNNING",
        executionState: "retry_scheduled",
        retryMetadata: {
          reasonCode: "provider_rate_limit_429",
          nextRetryAt: "2026-04-11T10:45:00.000Z",
          rateLimitResetAt: "2026-04-11T10:44:00.000Z",
          attempt: 2,
          maxAttempts: 4,
          providerTier: "free",
          usageLimit: { used: 10000, limit: 10000 },
        },
        displayName: "Retrying Chat",
        projectId: null,
        projectName: null,
        initialMessage: "Investigate issue",
      },
      isLoading: false,
    });
    useChatSessionTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "connected",
      isLoading: false,
      error: null,
    });
    useWorkflowRunMock.mockReturnValue({ data: null, isLoading: false });
    useWorkflowsMock.mockReturnValue({ data: [] });
    useWorkflowRunTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkspaceDerivedStateMock.mockReturnValue({
      chatMessages: [],
      agentTodos: [],
    });
    useActiveSessionWorkspaceActionsMock.mockReturnValue({
      onInject: vi.fn(),
      onSubmitAnswers: vi.fn(),
      injectMutation: { isPending: false },
      submitAnswersMutation: { isPending: false },
    });

    renderPane();

    expect(
      screen.getByText("Provider rate limit retry scheduled"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();
    expect(screen.getByText("Attempt 2 of 4")).toBeTruthy();
    expect(screen.getByText("Tier: free")).toBeTruthy();
    expect(screen.getByText("Usage: 10000/10000")).toBeTruthy();
    expect(
      (
        screen.getByPlaceholderText(
          "Waiting for provider rate limit reset...",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
  });

  it("lets users abort a running workflow from the session header", () => {
    const onAbort = vi.fn();
    useChatSessionMock.mockReturnValue({ data: null, isLoading: false });
    useChatSessionTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkflowRunMock.mockReturnValue({
      data: {
        id: "run-1",
        workflow_id: "project_orchestration_cycle_ceo",
        status: "RUNNING",
        state_variables: {},
      },
      isLoading: false,
    });
    useWorkflowsMock.mockReturnValue({ data: [] });
    useWorkflowRunTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkspaceDerivedStateMock.mockReturnValue({
      chatMessages: [],
      agentTodos: [],
    });
    useActiveSessionWorkspaceActionsMock.mockReturnValue({
      onAbort,
      onInject: vi.fn(),
      onSubmitAnswers: vi.fn(),
      abortMutation: { isPending: false },
      injectMutation: { isPending: false },
      submitAnswersMutation: { isPending: false },
    });

    renderPane({ kind: "workflow" });

    fireEvent.click(screen.getByRole("button", { name: "Abort Run" }));

    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("uses workflow run display names without loading the workflow catalog", () => {
    useChatSessionMock.mockReturnValue({ data: null, isLoading: false });
    useChatSessionTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkflowRunMock.mockReturnValue({
      data: {
        id: "run-1",
        workflow_id: "workflow-detail",
        display_name: "Workflow Detail API Name",
        workflow_name: "Workflow Detail API Name",
        status: "COMPLETED",
        state_variables: {},
      },
      isLoading: false,
    });
    useWorkflowsMock.mockReturnValue({ data: [] });
    useWorkflowRunTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkspaceDerivedStateMock.mockReturnValue({
      chatMessages: [],
      agentTodos: [],
    });
    useActiveSessionWorkspaceActionsMock.mockReturnValue({
      onAbort: vi.fn(),
      onInject: vi.fn(),
      onSubmitAnswers: vi.fn(),
      abortMutation: { isPending: false },
      injectMutation: { isPending: false },
      submitAnswersMutation: { isPending: false },
    });

    renderPane({ kind: "workflow" });

    expect(
      screen.getAllByText("Workflow Detail API Name").length,
    ).toBeGreaterThan(0);
    expect(useWorkflowsMock).not.toHaveBeenCalled();
  });

  it("shows a workflow retry banner and disables guidance input", () => {
    useChatSessionMock.mockReturnValue({ data: null, isLoading: false });
    useChatSessionTelemetryMock.mockReturnValue({
      events: [],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkflowRunMock.mockReturnValue({
      data: {
        id: "run-1",
        workflow_id: "project_orchestration_cycle_ceo",
        status: "RUNNING",
        current_step_id: "ceo_orchestration_decision",
        state_variables: {
          _internal: {
            auto_retry: {
              ceo_orchestration_decision: {
                attempt: 2,
                last_failure: {
                  reasonCode: "provider_rate_limit_429",
                  message: "Provider rate limit exceeded",
                  nextRetryAt: "2026-05-30T20:01:00.000Z",
                  resetAt: "2026-05-30T20:00:00.000Z",
                  providerTier: "Token Plan Plus",
                  usageLimit: { used: 4500, limit: 4500, unit: "tokens" },
                  retryQueueJobId:
                    "auto-retry-run-1-ceo_orchestration_decision",
                },
              },
            },
          },
        },
      },
      isLoading: false,
    });
    useWorkflowsMock.mockReturnValue({ data: [] });
    useWorkflowRunTelemetryMock.mockReturnValue({
      events: [
        {
          event_type: "workflow.retry_scheduled",
          timestamp: "2026-05-30T19:59:00.000Z",
          payload: {
            jobId: "ceo_orchestration_decision",
            attempt: 2,
            maxAttempts: 4,
          },
        },
      ],
      connectionState: "idle",
      isLoading: false,
      error: null,
    });
    useWorkspaceDerivedStateMock.mockReturnValue({
      chatMessages: [],
      agentTodos: [],
    });
    useActiveSessionWorkspaceActionsMock.mockReturnValue({
      onAbort: vi.fn(),
      onInject: vi.fn(),
      onSubmitAnswers: vi.fn(),
      abortMutation: { isPending: false },
      injectMutation: { isPending: false },
      submitAnswersMutation: { isPending: false },
    });

    renderPane({ kind: "workflow" });

    expect(
      screen.getByText("Provider rate limit retry scheduled"),
    ).toBeTruthy();
    expect(screen.getByText("Attempt 2 of 4")).toBeTruthy();
    expect(screen.getByText("Tier: Token Plan Plus")).toBeTruthy();
    expect(screen.getByText("Usage: 4500/4500")).toBeTruthy();
    expect(screen.getByText("Runtime state:")).toBeTruthy();
    expect(screen.getByText("retry scheduled")).toBeTruthy();
    expect(
      (
        screen.getByPlaceholderText(
          "Waiting for workflow retry to run...",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
  });
});
