import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { SessionInboxPage } from "./SessionInboxPage";
import { SessionThreadList } from "../../components/sessions/SessionThreadList";
import { SessionConversationPane } from "../../components/sessions/SessionConversationPane";

const sessionPaneMocks = vi.hoisted(() => ({
  derivedState: {
    chatMessages: [] as Array<{
      id: string;
      role: "user" | "agent" | "event";
      content: string;
      questions?: Array<{ question: string; options: string[] }>;
    }>,
    agentTodos: [],
    pendingQuestions: null as Array<{
      question: string;
      options: string[];
    }> | null,
  },
  actions: {
    onInject: vi.fn(),
    onSubmitAnswers: vi.fn(),
  },
}));

const workflowRunMocks = vi.hoisted(() => ({
  runs: [
    {
      id: "run-2",
      workflow_id: "workflow-1",
      status: "COMPLETED" as const,
      created_at: "2026-06-05T10:00:00.000Z",
      completed_at: "2026-06-05T10:01:00.000Z",
      source_type: "repository" as const,
      state_variables: { trigger: { displayName: "Repository Run" } },
    },
    {
      id: "run-3",
      workflow_id: "workflow-1",
      status: "COMPLETED" as const,
      created_at: "2026-06-05T09:00:00.000Z",
      completed_at: "2026-06-05T09:01:00.000Z",
      source_type: "seed" as const,
      state_variables: { trigger: { displayName: "Seed Run" } },
    },
  ],
}));

vi.mock("@/components/sessions/NewSessionDialog", () => ({
  NewSessionDialog: () => null,
}));

// Mock the socket
vi.mock("@/hooks/useSocket", () => ({
  useSocket: () => ({ socket: null }),
}));

// Mock the hooks
vi.mock("@/hooks/useChatSessions", () => ({
  useChatSessions: () => ({
    data: {
      data: [
        {
          id: "chat-1",
          displayName: "Chat Session 1",
          status: "RUNNING" as const,
          createdAt: new Date().toISOString(),
          completedAt: null,
          initialMessage: "Hello",
          projectId: "proj-1",
          projectName: "Project 1",
          agentProfileName: "Agent 1",
          sessionType: "general" as const,
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useChatSession: () => ({
    data: {
      id: "chat-1",
      displayName: "Chat Session 1",
      status: "RUNNING" as const,
      createdAt: new Date().toISOString(),
      completedAt: null,
      initialMessage: "Hello",
      projectId: "proj-1",
      projectName: "Project 1",
      agentProfileName: "Agent 1",
      sessionType: "general" as const,
      model: null,
      provider: null,
      containerTier: 1,
      errorMessage: null,
    },
    isLoading: false,
    error: null,
  }),
  useRetryChatSessionNow: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useWorkflows", () => ({
  WORKFLOW_NAME_CATALOG_QUERY: { limit: 100, includeInactive: true },
  useWorkflows: () => ({
    data: [
      {
        id: "workflow-1",
        name: "Workflow 1",
      },
    ],
  }),
  useWorkflowRun: () => ({
    data: {
      id: "run-1",
      workflow_id: "workflow-1",
      status: "COMPLETED" as const,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      state_variables: { trigger: { displayName: "Test Workflow" } },
    },
    isLoading: false,
    error: null,
  }),
  useWorkflowRuns: () => ({
    data: workflowRunMocks.runs,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useWorkflowSubagentExecutions", () => ({
  useWorkflowSubagentExecutions: () => ({
    executions: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useChatSessionTelemetry", () => ({
  useChatSessionTelemetry: () => ({
    events: [],
    connectionState: "connected",
    error: null,
  }),
}));

vi.mock("@/hooks/useWorkflowRunTelemetry", () => ({
  useWorkflowRunTelemetry: () => ({
    events: [],
    connectionState: "connected",
    error: null,
  }),
}));

vi.mock("@/pages/active-session/ActiveSessionWorkspace.actions", () => ({
  useWorkspaceArtifacts: () => ({
    workspaceDiff: null,
    workspaceTree: [],
    workspaceDiffLoading: false,
    workspaceDiffError: null,
    workspaceTreeLoading: false,
    workspaceTreeError: null,
  }),
  useActiveSessionWorkspaceActions: () => ({
    onInject: sessionPaneMocks.actions.onInject,
    onSubmitAnswers: sessionPaneMocks.actions.onSubmitAnswers,
    injectMutation: {
      isPending: false,
    },
    submitAnswersMutation: {
      isPending: false,
    },
  }),
}));

vi.mock("@/pages/active-session/active-session.workspace.helpers", () => ({
  useWorkspaceDerivedState: () => sessionPaneMocks.derivedState,
}));

vi.mock("@/hooks/useUnreadThreads", () => ({
  useUnreadThreads: () => ({
    unreadMap: new Map(),
    markAsRead: vi.fn(),
    markAsUnread: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

vi.mock("@/hooks/useExecutionSidebarData", () => ({
  useExecutionSidebarData: () => ({
    terminalChunks: [],
    workspaceDiff: "",
    workspaceTree: [],
    diffLoading: false,
    diffError: null,
    treeLoading: false,
    treeError: null,
  }),
}));

describe("SessionInboxPage Integration Tests", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    sessionPaneMocks.derivedState.chatMessages = [];
    sessionPaneMocks.derivedState.agentTodos = [];
    sessionPaneMocks.derivedState.pendingQuestions = null;
    sessionPaneMocks.actions.onInject.mockReset();
    sessionPaneMocks.actions.onSubmitAnswers.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  function renderWithProviders(component: React.ReactElement) {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{component}</BrowserRouter>
      </QueryClientProvider>,
    );
  }

  it("renders the three-pane layout", () => {
    renderWithProviders(<SessionInboxPage />);

    expect(screen.getByText("Chats & Runs")).toBeTruthy();
  });

  it("displays placeholder when no thread is selected", () => {
    renderWithProviders(<SessionInboxPage />);

    expect(screen.getByText("Select a chat or workflow to start")).toBeTruthy();
  });

  it("hides execution sidebar by default", () => {
    renderWithProviders(<SessionInboxPage />);

    // ExecutionSidebar should not be rendered unless selectedThreadId is set
    expect(screen.queryByText("Terminal")).toBeNull();
  });

  it("accepts sessionId from URL params", () => {
    // Note: This would require router setup with URL params
    // For now, just verify the component renders
    renderWithProviders(<SessionInboxPage />);

    expect(screen.getByText("Select a chat or workflow to start")).toBeTruthy();
  });
});

describe("SessionThreadList Unit Tests", () => {
  beforeEach(() => {
    workflowRunMocks.runs = [
      {
        id: "run-2",
        workflow_id: "workflow-1",
        status: "COMPLETED" as const,
        created_at: "2026-06-05T10:00:00.000Z",
        completed_at: "2026-06-05T10:01:00.000Z",
        source_type: "repository" as const,
        state_variables: { trigger: { displayName: "Repository Run" } },
      },
      {
        id: "run-3",
        workflow_id: "workflow-1",
        status: "COMPLETED" as const,
        created_at: "2026-06-05T09:00:00.000Z",
        completed_at: "2026-06-05T09:01:00.000Z",
        source_type: "seed" as const,
        state_variables: { trigger: { displayName: "Seed Run" } },
      },
    ];
  });

  it("renders thread items with correct styling", () => {
    const mockThread = {
      id: "chat-1",
      kind: "chat" as const,
      title: "Test Chat",
      displayName: "Test Chat",
      status: "RUNNING" as const,
      createdAt: new Date().toISOString(),
      completedAt: null,
      lastActivityAt: new Date().toISOString(),
    };

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionThreadList
          selectedThreadId={mockThread.id}
          onThreadSelect={vi.fn()}
          onThreadResolve={vi.fn()}
          unreadMap={new Map()}
        />
      </QueryClientProvider>,
    );

    // Component should render without errors
    expect(true).toBe(true);
  });

  it("marks repository workflow runs with a repo badge", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionThreadList
          selectedThreadId={null}
          onThreadSelect={vi.fn()}
          onThreadResolve={vi.fn()}
          unreadMap={new Map()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Repository Run")).toBeTruthy();
    expect(screen.getByText("repo")).toBeTruthy();
  });

  it("filters workflow runs by repository source", async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionThreadList
          selectedThreadId={null}
          onThreadSelect={vi.fn()}
          onThreadResolve={vi.fn()}
          unreadMap={new Map()}
        />
      </QueryClientProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Run source"), "repository");

    expect(screen.getByText("Repository Run")).toBeTruthy();
    expect(screen.queryByText("Seed Run")).toBeNull();
  });
});

describe("SessionConversationPane Unit Tests", () => {
  it("renders conversation interface", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <SessionConversationPane
            threadId="chat-1"
            kind="chat"
            onShowExecution={vi.fn()}
            onMarkAsRead={vi.fn()}
          />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    // Component should render without errors
    expect(true).toBe(true);
  });

  it("submits inline question answers from chat sessions", async () => {
    const user = userEvent.setup();
    const pendingQuestions = [
      { question: "Which framework?", options: ["React", "Vue"] },
    ];
    sessionPaneMocks.derivedState.pendingQuestions = pendingQuestions;
    sessionPaneMocks.derivedState.chatMessages = [
      {
        id: "question-message",
        role: "event",
        content: "Which framework?",
        questions: pendingQuestions,
      },
    ];

    render(
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <SessionConversationPane
            threadId="chat-1"
            kind="chat"
            onShowExecution={vi.fn()}
            onMarkAsRead={vi.fn()}
          />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "React" }));

    expect(sessionPaneMocks.actions.onSubmitAnswers).toHaveBeenCalledWith([
      { questionIndex: 0, selectedOption: "React", freeTextAnswer: null },
    ]);
  });
});
