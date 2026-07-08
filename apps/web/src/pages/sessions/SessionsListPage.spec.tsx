import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { SessionsListPage } from "./SessionsListPage";

const useChatSessionsMock = vi.hoisted(() => vi.fn());
const useWorkflowRunsMock = vi.hoisted(() => vi.fn());
const useWorkflowsMock = vi.hoisted(() => vi.fn());
const useChatSessionTelemetryMock = vi.hoisted(() => vi.fn());
const useWorkflowRunTelemetryMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useChatSessions", () => ({
  useChatSessions: useChatSessionsMock,
}));

vi.mock("@/hooks/useWorkflows", () => ({
  WORKFLOW_NAME_CATALOG_QUERY: { limit: 100, includeInactive: true },
  useWorkflowRuns: useWorkflowRunsMock,
  useWorkflowRun: vi.fn(),
  useWorkflows: useWorkflowsMock,
}));

vi.mock("@/hooks/useChatSessionTelemetry", () => ({
  useChatSessionTelemetry: useChatSessionTelemetryMock,
}));

vi.mock("@/hooks/useWorkflowRunTelemetry", () => ({
  useWorkflowRunTelemetry: useWorkflowRunTelemetryMock,
}));

vi.mock("@/components/sessions/NewSessionDialog", () => ({
  NewSessionDialog: () => null,
}));

function renderWithProviders(ui: ReactElement, route?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={route ? [route] : undefined}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
  {
    id: "chat-complete",
    sessionType: "steering",
    status: "COMPLETED",
    executionState: "completed",
    retryMetadata: null,
    failureInfo: null,
    agentProfileName: "architect",
    projectId: null,
    projectName: null,
    displayName: "Chat Completed",
    initialMessage: "Done",
    workflowRunId: null,
    createdAt: "2026-04-10T10:30:00.000Z",
    completedAt: "2026-04-10T10:45:00.000Z",
  },
];

const workflowRunsFixture: WorkflowRun[] = [
  {
    id: "run-pending",
    workflow_id: "wf-1",
    status: "PENDING",
    current_step_id: null,
    state_variables: {
      trigger: {
        display_name: "Workflow Pending",
        task_prompt: "Implement feature",
      },
    },
    created_at: "2026-04-11T09:30:00.000Z",
    updated_at: "2026-04-11T09:30:00.000Z",
  },
  {
    id: "run-failed",
    workflow_id: "wf-2",
    display_name: "Review Workflow",
    workflow_name: "Review Workflow",
    status: "FAILED",
    current_step_id: "build",
    state_variables: {},
    created_at: "2026-04-09T09:30:00.000Z",
    updated_at: "2026-04-09T09:30:00.000Z",
  },
];

describe("SessionsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    useChatSessionTelemetryMock.mockReturnValue({
      events: [],
      isLoading: false,
      error: null,
      connectionState: "connected",
    });
    useWorkflowRunTelemetryMock.mockReturnValue({
      events: [],
      isLoading: false,
      error: null,
      connectionState: "connected",
    });
    useChatSessionsMock.mockImplementation((params) => {
      let data = chatSessionsFixture;
      if (params?.status) {
        const statuses = new Set(params.status.split(","));
        data = data.filter((s) => statuses.has(s.status));
      }
      return {
        data: {
          data,
          meta: { pagination: { total: data.length, limit: 10, offset: 0 } },
        },
        isLoading: false,
      };
    });
    useWorkflowRunsMock.mockImplementation((params) => {
      let data = workflowRunsFixture;
      if (params?.status) {
        const statuses = new Set(params.status.split(","));
        data = data.filter((s) => statuses.has(s.status));
      }
      return {
        data,
        isLoading: false,
      };
    });
    useWorkflowsMock.mockReturnValue({
      data: [
        {
          id: "wf-2",
          name: "Review Workflow",
          yaml_definition: "workflow_id: wf-2",
          is_active: true,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
    });
  });

  it("shows unified conversation list with terminal and active sessions", () => {
    renderWithProviders(<SessionsListPage />);

    expect(screen.getByText("Conversations")).toBeTruthy();
    expect(screen.getByText("Chat Running")).toBeTruthy();
    expect(screen.getAllByText("Workflow Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Chat Completed")).toBeTruthy();
    expect(screen.getByText("Review Workflow")).toBeTruthy();
    expect(useWorkflowsMock).not.toHaveBeenCalled();
    expect(screen.getByText("Session Panel")).toBeTruthy();
  });

  it("renders empty state when no active sessions exist", () => {
    useChatSessionsMock.mockImplementation(() => ({
      data: {
        data: [],
        meta: { pagination: { total: 0, limit: 10, offset: 0 } },
      },
      isLoading: false,
    }));
    useWorkflowRunsMock.mockImplementation(() => ({
      data: [],
      isLoading: false,
    }));

    renderWithProviders(<SessionsListPage />);

    expect(screen.getByText("No active conversations.")).toBeTruthy();
  });

  it("renders list error state when session queries fail", () => {
    useChatSessionsMock.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Chat API unavailable"),
    }));
    useWorkflowRunsMock.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Workflow API unavailable"),
    }));

    renderWithProviders(<SessionsListPage />);

    expect(screen.getByText(/Chat API unavailable/)).toBeTruthy();
    expect(screen.getByText(/Workflow API unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("uses route params to select workflow run conversation", () => {
    renderWithProviders(
      <Routes>
        <Route path="/sessions/:runId" element={<SessionsListPage />} />
      </Routes>,
      "/sessions/run-pending",
    );

    expect(screen.getAllByText("Workflow Pending").length).toBeGreaterThan(0);
    expect(useWorkflowRunTelemetryMock).toHaveBeenCalledWith("run-pending");
    expect(useChatSessionTelemetryMock).toHaveBeenCalledWith(undefined);
  });

  it("requests full status sets by default", () => {
    renderWithProviders(<SessionsListPage />);

    expect(useChatSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "RUNNING,STARTING,COMPLETED,FAILED,CANCELLED",
      }),
    );
    expect(useWorkflowRunsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "RUNNING,PENDING,COMPLETED,FAILED,CANCELLED",
      }),
    );
  });
});
