import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications";
import { useNotifications } from "@/hooks/useNotifications";
import { api } from "@/lib/api/client";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    getWorkflowRun: vi.fn(),
    submitQuestionAnswers: vi.fn(),
    submitChatSessionQuestionAnswers: vi.fn(),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>
  </MemoryRouter>
);

describe("Notifications page", () => {
  const markReadMutate = vi.fn();
  const markAllReadMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWorkflowRun).mockResolvedValue({
      id: "run-1",
      workflow_id: "workflow-1",
    } as never);
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "1",
          subject: "Test Notification",
          body: "Test body",
          eventType: "workflow.run.failed",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-1", workflowRunId: "run-1" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);
  });

  it("renders notification list", () => {
    render(<Notifications />, { wrapper });
    expect(screen.getByText("Test Notification")).toBeTruthy();
    expect(screen.getByText("Test body")).toBeTruthy();
  });

  it("marks notification as read on click", () => {
    render(<Notifications />, { wrapper });
    fireEvent.click(screen.getByText("Test Notification"));
    expect(markReadMutate).toHaveBeenCalledWith("1");
  });

  it("navigates workflow failure notifications to workflow run detail", async () => {
    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Test Notification"));

    await waitFor(() => {
      expect(api.getWorkflowRun).toHaveBeenCalledWith("run-1");
      expect(navigateMock).toHaveBeenCalledWith(
        "/workflows/workflow-1/runs/run-1",
      );
    });
  });

  it("navigates orchestration approval notifications to project orchestration tab", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "2",
          subject: "Approval Required: Continue",
          body: "An orchestration action requires your review.",
          eventType: "orchestration_action.pending",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-1", actionRequestId: "action-1" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Approval Required: Continue"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/projects/project-1?tab=orchestration",
      );
    });
    expect(api.getWorkflowRun).not.toHaveBeenCalled();
  });

  it("navigates tool approval notifications to project orchestration tab", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "3",
          subject: "Tool Approval Needed: read",
          body: "A tool call (read) requires approval.",
          eventType: "tool_call.approval_needed",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-2", requestId: "request-1" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Tool Approval Needed: read"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/projects/project-2?tab=orchestration",
      );
    });
  });

  it("navigates waiting input notifications to the active session for the run", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "4",
          subject: "Input Needed From You",
          body: "The orchestrator has a question for you.",
          eventType: "work_item.waiting_input",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-3", workflowRunId: "run-42" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Input Needed From You"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/projects/project-3/runs/run-42/active-session",
      );
    });
    expect(api.getWorkflowRun).not.toHaveBeenCalled();
  });

  it("shows empty state when no notifications", () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [],
      actionItems: [],
      unreadCount: 0,
      total: 0,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });
    expect(screen.getByText("No notifications")).toBeTruthy();
  });

  it("navigates work item blocked notifications to project page", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "5",
          subject: "Work Item Blocked",
          body: "A work item has been blocked and requires attention.",
          eventType: "work_item.blocked",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-4", workItemId: "work-1" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Work Item Blocked"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/projects/project-4");
    });
    expect(api.getWorkflowRun).not.toHaveBeenCalled();
  });

  it("navigates work item ready for review notifications to project page", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "6",
          subject: "Work Item Ready For Review",
          body: "A work item is ready for review.",
          eventType: "work_item.ready_for_review",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-5", workItemId: "work-2" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Work Item Ready For Review"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/projects/project-5");
    });
  });

  it("navigates work item ready to merge notifications to project page", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "7",
          subject: "Work Item Ready To Merge",
          body: "A work item is ready to merge.",
          eventType: "work_item.ready_to_merge",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-6", workItemId: "work-3" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Work Item Ready To Merge"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/projects/project-6");
    });
  });

  it("navigates workflow repair warning to workflow run detail", async () => {
    vi.mocked(useNotifications).mockReturnValue({
      notifications: [
        {
          id: "8",
          subject: "Workflow Repair Warning",
          body: "Repair denied by policy.",
          eventType: "workflow.repair.warning",
          readAt: null,
          createdAt: "2026-04-19T12:00:00Z",
          metadata: { projectId: "project-7", workflowRunId: "run-99" },
        },
      ],
      actionItems: [],
      unreadCount: 1,
      total: 1,
      markRead: { mutate: markReadMutate, isPending: false },
      markAllRead: { mutate: markAllReadMutate, isPending: false },
      isLoading: false,
    } as never);

    render(<Notifications />, { wrapper });

    fireEvent.click(screen.getByText("Workflow Repair Warning"));

    await waitFor(() => {
      expect(api.getWorkflowRun).toHaveBeenCalledWith("run-99");
      expect(navigateMock).toHaveBeenCalledWith(
        "/workflows/workflow-1/runs/run-1",
      );
    });
  });

  describe("scopeId metadata fallback (post-April refactor)", () => {
    it("navigates orchestration action notifications using scopeId when projectId is absent", async () => {
      vi.mocked(useNotifications).mockReturnValue({
        notifications: [
          {
            id: "10",
            subject: "Action Required: approve",
            body: "Orchestration action 'approve' is pending approval.",
            eventType: "orchestration_action.pending",
            readAt: null,
            createdAt: "2026-05-01T10:00:00Z",
            metadata: {
              scopeId: "scope-abc",
              actionRequestId: "action-42",
              action: "approve",
            },
          },
        ],
        actionItems: [],
        unreadCount: 1,
        total: 1,
        markRead: { mutate: markReadMutate, isPending: false },
        markAllRead: { mutate: markAllReadMutate, isPending: false },
        isLoading: false,
      } as never);

      render(<Notifications />, { wrapper });
      fireEvent.click(screen.getByText("Action Required: approve"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith(
          "/projects/scope-abc?tab=orchestration",
        );
      });
    });

    it("navigates workflow.user_input.required notifications using scopeId when projectId is absent", async () => {
      vi.mocked(useNotifications).mockReturnValue({
        notifications: [
          {
            id: "11",
            subject: "Input Needed From You",
            body: "Shall we proceed?",
            eventType: "workflow.user_input.required",
            readAt: null,
            createdAt: "2026-05-01T10:00:00Z",
            metadata: {
              scopeId: "scope-xyz",
              workflowRunId: "run-77",
              questions: [],
            },
          },
        ],
        actionItems: [],
        unreadCount: 1,
        total: 1,
        markRead: { mutate: markReadMutate, isPending: false },
        markAllRead: { mutate: markAllReadMutate, isPending: false },
        isLoading: false,
      } as never);

      render(<Notifications />, { wrapper });
      fireEvent.click(screen.getByText("Input Needed From You"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith(
          "/projects/scope-xyz/runs/run-77/active-session",
        );
      });
    });

    it("navigates workflow.run.failed notifications using scopeId when projectId is absent", async () => {
      vi.mocked(api.getWorkflowRun).mockResolvedValue({
        id: "run-88",
        workflow_id: "workflow-99",
      } as never);

      vi.mocked(useNotifications).mockReturnValue({
        notifications: [
          {
            id: "12",
            subject: "Workflow Run Failed",
            body: "Workflow run run-88 failed.",
            eventType: "workflow.run.failed",
            readAt: null,
            createdAt: "2026-05-01T10:00:00Z",
            metadata: { scopeId: "scope-def", workflowRunId: "run-88" },
          },
        ],
        actionItems: [],
        unreadCount: 1,
        total: 1,
        markRead: { mutate: markReadMutate, isPending: false },
        markAllRead: { mutate: markAllReadMutate, isPending: false },
        isLoading: false,
      } as never);

      render(<Notifications />, { wrapper });
      fireEvent.click(screen.getByText("Workflow Run Failed"));

      await waitFor(() => {
        expect(api.getWorkflowRun).toHaveBeenCalledWith("run-88");
        expect(navigateMock).toHaveBeenCalledWith(
          "/workflows/workflow-99/runs/run-88",
        );
      });
    });
  });
});
