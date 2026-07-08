import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SubagentExecutionPanel } from "./SubagentExecutionPanel";

const hookMocks = vi.hoisted(() => ({
  useWorkflowSubagentExecutions: vi.fn(),
  useChatSessions: vi.fn(),
}));

vi.mock("@/hooks/useWorkflowSubagentExecutions", () => ({
  useWorkflowSubagentExecutions: hookMocks.useWorkflowSubagentExecutions,
}));

vi.mock("@/hooks/useChatSessions", () => ({
  useChatSessions: hookMocks.useChatSessions,
}));

describe("SubagentExecutionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMocks.useWorkflowSubagentExecutions.mockReturnValue({
      executions: [
        {
          id: "exec-1",
          status: "running",
          lastEventName: "spawn.succeeded",
          lastEventAt: "2026-05-01T12:00:01.000Z",
          childContainerId: "container-1",
          subagentChatSessionId: "chat-session-1",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });
    hookMocks.useChatSessions.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("uses linked subagent chat session status when available", () => {
    hookMocks.useChatSessions.mockReturnValue({
      data: {
        data: [
          {
            id: "chat-session-1",
            status: "COMPLETED",
            source: "subagent",
            workflowRunId: "workflow-run-1",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<SubagentExecutionPanel workflowRunId="workflow-run-1" />);

    expect(screen.getByText("COMPLETED")).toBeTruthy();
    expect(screen.queryByText("RUNNING")).toBeNull();
  });

  it("falls back to execution status when linked chat session is unavailable", () => {
    render(<SubagentExecutionPanel workflowRunId="workflow-run-1" />);

    expect(screen.getByText("RUNNING")).toBeTruthy();
  });

  it("renders the execution list expanded by default", () => {
    render(<SubagentExecutionPanel workflowRunId="workflow-run-1" />);

    expect(screen.getByText("exec-1")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /collapse subagent executions/i }),
    ).toBeTruthy();
  });

  it("collapses and expands the execution list via the header toggle", () => {
    render(<SubagentExecutionPanel workflowRunId="workflow-run-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: /collapse subagent executions/i }),
    );

    expect(screen.queryByText("exec-1")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /expand subagent executions/i }),
    );

    expect(screen.getByText("exec-1")).toBeTruthy();
  });
});
