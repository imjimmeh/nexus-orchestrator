import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationTab } from "./OrchestrationTab";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => toastMock,
}));

const memoryMetricsMock = vi.hoisted(() => ({
  useMemoryMetrics: vi.fn(),
}));

vi.mock("@/hooks/useMemoryMetrics", () => memoryMetricsMock);

const promotedLessonsMock = vi.hoisted(() => ({
  usePromotedLessons: vi.fn(),
}));

vi.mock("@/hooks/usePromotedLessons", () => promotedLessonsMock);

const orchestrationHooksMock = vi.hoisted(() => ({
  useProjectOrchestrationState: vi.fn(),
  useStartProjectOrchestration: vi.fn(),
  useUpdateProjectOrchestrationMode: vi.fn(),
  useApproveProjectOrchestration: vi.fn(),
  useApproveProjectOrchestrationAction: vi.fn(),
  useRejectProjectOrchestration: vi.fn(),
  useRejectProjectOrchestrationAction: vi.fn(),
  usePauseProjectOrchestration: vi.fn(),
  useResumeProjectOrchestration: vi.fn(),
  useRecoverImportedHydrationProjectOrchestration: vi.fn(),
  useCompleteProjectOrchestration: vi.fn(),
  useResetProjectOrchestrationIntents: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getProjectGoals: vi.fn(),
  getWorkflowRuns: vi.fn(),
  getWorkflowRun: vi.fn(),
  getWorkflowRunEvents: vi.fn(),
  getProjectOrchestrationDiagnostics: vi.fn(),
  getRuntimeCapabilities: vi.fn(),
  replayProjectRetrospective: vi.fn(),
  listProjectWarRoomSessions: vi.fn(),
  getProjectWarRoomSessionState: vi.fn(),
  openProjectWarRoomSession: vi.fn(),
  inviteProjectWarRoomParticipant: vi.fn(),
  postProjectWarRoomMessage: vi.fn(),
  closeProjectWarRoomSession: vi.fn(),
  submitQuestionAnswers: vi.fn(),
}));

vi.mock("@/hooks/useProjectOrchestration", () => orchestrationHooksMock);
vi.mock("@/lib/api/client", () => ({ api: apiMock }));
vi.mock("@/hooks/useOrchestrationPolicy", () => ({
  useOrchestrationPolicy: vi
    .fn()
    .mockReturnValue({ data: [], isLoading: false }),
  useUpdateOrchestrationPolicy: vi
    .fn()
    .mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useApplyOrchestrationPreset: vi
    .fn()
    .mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function setupHookDefaults() {
  orchestrationHooksMock.useStartProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  orchestrationHooksMock.useUpdateProjectOrchestrationMode.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useApproveProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useRejectProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useApproveProjectOrchestrationAction.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  orchestrationHooksMock.useRejectProjectOrchestrationAction.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  orchestrationHooksMock.usePauseProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useResumeProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useRecoverImportedHydrationProjectOrchestration.mockReturnValue(
    {
      mutateAsync: vi.fn(),
      isPending: false,
    },
  );
  orchestrationHooksMock.useCompleteProjectOrchestration.mockReturnValue({
    mutateAsync: vi.fn(),
  });
  orchestrationHooksMock.useResetProjectOrchestrationIntents.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
}

describe("OrchestrationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMetricsMock.useMemoryMetrics.mockReturnValue({ data: undefined });
    promotedLessonsMock.usePromotedLessons.mockReturnValue({ data: undefined });
    apiMock.get.mockResolvedValue({
      projectId: "project-1",
      generatedAt: "2026-05-18T20:00:00.000Z",
      lanes: [],
      facts: [],
      noLaunchReasons: [],
      staleLinks: [],
    });
    apiMock.getWorkflowRuns.mockResolvedValue([]);
    apiMock.getProjectGoals.mockResolvedValue([]);
    apiMock.getWorkflowRun.mockResolvedValue(null);
    apiMock.getWorkflowRunEvents.mockResolvedValue([]);
    apiMock.getProjectOrchestrationDiagnostics.mockResolvedValue({
      project_id: "project-1",
      blocked: false,
      reasons: [],
      latest_run: null,
      latest_failure_event: null,
    });
    apiMock.getRuntimeCapabilities.mockResolvedValue({
      workflow_run_id: "run-1",
      job_id: "job-1",
      project_id: "project-1",
      orchestration_mode: "supervised",
      callable_tools: ["query_memory"],
      denied_tools: [],
      approval_required_tools: [],
      required_next_action: "none",
    });
    apiMock.replayProjectRetrospective.mockResolvedValue({
      status: "succeeded",
      lessonCount: 1,
    });
    apiMock.listProjectWarRoomSessions.mockResolvedValue({
      workflow_run_id: "run-1",
      sessions: [],
    });
    apiMock.getProjectWarRoomSessionState.mockResolvedValue({
      status: "not_found",
      session_id: "none",
      workflow_run_id: "run-1",
    });
    apiMock.openProjectWarRoomSession.mockResolvedValue({
      status: "opened",
      session_id: "war-room-1",
      workflow_run_id: "run-1",
      project_id: "project-1",
      work_item_id: null,
      session_status: "open",
      consensus_state: "collecting_input",
      lifecycle_events: [],
    });
    apiMock.inviteProjectWarRoomParticipant.mockResolvedValue({
      status: "invited",
      session_id: "war-room-1",
      workflow_run_id: "run-1",
      participant: null,
      lifecycle_events: [],
    });
    apiMock.postProjectWarRoomMessage.mockResolvedValue({
      status: "posted",
      session_id: "war-room-1",
      workflow_run_id: "run-1",
      message_id: "msg-1",
      message_kind: "proposal",
      consensus_state: "collecting_input",
      lifecycle_events: [],
    });
    apiMock.closeProjectWarRoomSession.mockResolvedValue({
      status: "closed",
      session_id: "war-room-1",
      workflow_run_id: "run-1",
      session_status: "closed",
      consensus_state: "consensus_reached",
      resolution_type: "consensus",
      lifecycle_events: [],
    });
    apiMock.submitQuestionAnswers.mockResolvedValue({ acknowledged: true });
  });

  it("renders empty state when orchestration is not started", () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: null,
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(screen.getByText("Orchestration Controls")).toBeTruthy();
    expect(
      screen.getByText(
        "Orchestration has not been started for this project yet.",
      ),
    ).toBeTruthy();
  });

  it("disables start during active orchestration and removes top approval controls", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 1,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(
      screen.getByRole("button", { name: "Start" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(
      screen.queryByText("Revision Feedback (for Reject action)"),
    ).toBeNull();
  });

  it("blocks completion when diagnostics readiness is not ok", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRuns.mockResolvedValue([]);
    apiMock.getProjectOrchestrationDiagnostics.mockResolvedValue({
      project_id: "project-1",
      blocked: true,
      reasons: [],
      latest_run: null,
      latest_failure_event: null,
      completion_readiness: {
        ok: false,
        phase: "orchestrating",
        checked_at: "2026-04-19T20:00:00.000Z",
        blocking_reasons: [
          {
            code: "goals_incomplete",
            message: "8 goals are not completed.",
          },
        ],
      },
    });

    const completeMutation = {
      mutateAsync: vi.fn(),
    };
    orchestrationHooksMock.useCompleteProjectOrchestration.mockReturnValue(
      completeMutation,
    );

    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: "summary",
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));

    await waitFor(() => {
      expect(completeMutation.mutateAsync).not.toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Action Failed",
        expect.stringMatching(/Completion blocked: goals_incomplete/i),
      );
    });
  });

  it("shows missing run linkage alert and refresh action", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRuns.mockResolvedValue([]);
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: "summary",
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(
      await screen.findByText("No Active Workflow Run Linked"),
    ).toBeTruthy();

    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh Run Link" }),
    );

    await waitFor(() => {
      expect(apiMock.getWorkflowRuns.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
    });
  });

  it("shows go-to-approvals action when pending action requests exist", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "awaiting_approval",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 1,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [
          {
            id: "req-1",
            projectId: "project-1",
            action: "dispatch_start_work_items",
            payload: null,
            workflowRunId: "run-1",
            modeAtRequest: "supervised",
            requestedBy: "ceo_agent",
            status: "pending",
            approvedBy: null,
            approvedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
            executedAt: null,
            errorMessage: null,
            correlationId: "corr-1",
            created_at: "2026-04-04T10:00:00.000Z",
            updated_at: "2026-04-04T10:00:00.000Z",
          },
        ],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(screen.getByRole("link", { name: "Go to approvals" })).toBeTruthy();
  });

  it("shows goals-tab guidance in restart dialog", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "failed",
          goals: "Ship the todo MVP with auth",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(
      await screen.findByText(/Goals are maintained in the Goals tab\./i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Restart Orchestration" }),
    ).toBeTruthy();
  });

  it("loads fallback workflow runs scoped to the current project", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRuns.mockResolvedValue([]);
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    await waitFor(() => {
      expect(apiMock.getWorkflowRuns).toHaveBeenCalledWith({
        projectId: "project-1",
      });
    });
  });

  it("renders go to active session links when a matching work item execution exists", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [
        {
          id: "work-1",
          projectId: "project-1",
          title: "Handle pending orchestration prompt",
          status: "in-progress",
          type: "story",
          priority: "high",
          currentExecutionId: "run-1",
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "discovery",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 1,
          activeCount: 1,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    await waitFor(() => {
      const links = screen.getAllByRole("link", {
        name: "Go to Active Session",
      });

      expect(
        links.some(
          (link) =>
            link.getAttribute("href") ===
            "/projects/project-1/work-items/work-1/active-session",
        ),
      ).toBe(true);
    });
  });

  it("renders run-scoped active session links when no work item execution is linked", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "discovery",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    const links = await screen.findAllByRole("link", {
      name: "Go to Active Session",
    });

    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute("href")).toBe(
      "/projects/project-1/runs/run-1/active-session",
    );
  });

  it("submits pending question answers from orchestration tab", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "discovery",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    apiMock.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: "user_questions_posed",
        timestamp: "2026-04-04T10:01:00.000Z",
        payload: {
          questions: [{ question: "Choose stack", options: ["React", "Vue"] }],
        },
      },
    ]);
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(
      await screen.findByText("Agent is asking for your input"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Answers" }));

    await waitFor(() => {
      expect(apiMock.submitQuestionAnswers).toHaveBeenCalledWith(
        "run-1",
        expect.arrayContaining([
          expect.objectContaining({
            questionIndex: 0,
            selectedOption: "React",
          }),
        ]),
      );
    });
  });

  it("shows runtime capability health and blockers", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "job-1",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    apiMock.getProjectOrchestrationDiagnostics.mockResolvedValueOnce({
      project_id: "project-1",
      blocked: true,
      reasons: [
        {
          code: "pending_action_approval",
          message: "1 orchestration action is waiting for approval.",
        },
      ],
      latest_run: null,
      latest_failure_event: null,
      dispatch_polling: {
        enabled: true,
        last_tick: {
          source: "poll",
          tickBucket: 123,
          intervalSeconds: 30,
          batchSize: 50,
          scannedProjectCount: 2,
          enqueuedProjectCount: 2,
          skippedProjectCount: 0,
          durationMs: 15,
          createdAt: "2026-04-06T10:00:00.000Z",
        },
        last_project_outcome: {
          projectId: "project-1",
          reason: "poll_tick:123",
          tickBucket: 123,
          polledAt: "2026-04-06T10:00:01.000Z",
        },
      },
      dispatch_capacity: {
        maxActive: 4,
        activeCount: 0,
        availableSlots: 4,
        projectAvailableSlots: 4,
        agentCapacityEnabled: true,
        configuredAgentCount: 2,
        idleAgentCount: 2,
        agentAvailableSlots: 4,
      },
    });
    apiMock.getRuntimeCapabilities.mockResolvedValueOnce({
      workflow_run_id: "run-1",
      job_id: "job-1",
      project_id: "project-1",
      orchestration_mode: "supervised",
      callable_tools: ["query_memory", "get_project_state"],
      denied_tools: [
        {
          toolName: "dispatch_start_work_items",
          reasonCode: "mode_denied",
          reason: "Current orchestration mode denies this mutating capability.",
        },
      ],
      approval_required_tools: ["update_project_strategy"],
      required_next_action: "approval_required",
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    expect(await screen.findByText("Runtime Capability Health")).toBeTruthy();
    expect(await screen.findByText("Denied Tool Reasons")).toBeTruthy();
    expect(await screen.findByText(/pending_action_approval/i)).toBeTruthy();
    expect(await screen.findByText("Dispatch Polling")).toBeTruthy();
    expect(await screen.findByText(/Status: enabled/i)).toBeTruthy();
    expect(await screen.findByText("Dispatch Capacity")).toBeTruthy();
    expect(await screen.findByText(/Active \/ max: 0 \/ 4/i)).toBeTruthy();
  });

  it("replays retrospective diagnostics from orchestration tab", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "job-1",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    apiMock.getProjectOrchestrationDiagnostics.mockResolvedValueOnce({
      project_id: "project-1",
      blocked: false,
      reasons: [],
      latest_run: null,
      latest_failure_event: null,
      retrospective: {
        status: "succeeded",
        latest_orchestration_id: "orch-1",
        last_started_at: "2026-04-06T09:00:00.000Z",
        last_completed_at: "2026-04-06T09:01:00.000Z",
        lesson_count: 3,
        last_error_code: null,
        last_error_message: null,
        remediation: null,
      },
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Replay retrospective" }),
    );

    await waitFor(() => {
      expect(apiMock.replayProjectRetrospective).toHaveBeenCalledWith(
        "project-1",
        { mode: "append" },
      );
    });
  });

  it("opens a war room session from manager panel", async () => {
    setupHookDefaults();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });
    apiMock.getWorkflowRun.mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      current_step_id: "job-1",
      state_variables: {},
      started_at: "2026-04-04T10:00:00.000Z",
      completed_at: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });
    orchestrationHooksMock.useProjectOrchestrationState.mockReturnValue({
      data: {
        orchestration: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Ship project UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: "run-1",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
        projectState: {
          projectId: "project-1",
          totalCount: 0,
          activeCount: 0,
          groupedByStatus: {},
        },
        pendingActionRequests: [],
      },
      isLoading: false,
    });

    renderWithQuery(<OrchestrationTab projectId="project-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Session" }),
    );

    await waitFor(() => {
      expect(apiMock.openProjectWarRoomSession).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ workflow_run_id: "run-1" }),
      );
    });
  });
});
