import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionContextPanel } from "./SessionContextPanel";
import type { SessionThread } from "./session-thread.types";

function workflowThread(overrides: Partial<SessionThread> = {}): SessionThread {
  return {
    id: "run-1",
    kind: "workflow",
    title: "Workflow Run",
    displayName: "Workflow Run",
    status: "RUNNING",
    createdAt: "2026-04-30T12:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("SessionContextPanel", () => {
  it("exposes abort control for active workflow sessions", () => {
    const onAbortWorkflowRun = vi.fn();

    render(
      <SessionContextPanel
        selectedThread={workflowThread()}
        isAgentChatting={false}
        onOpenWorkspace={vi.fn()}
        onAbortWorkflowRun={onAbortWorkflowRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abort Run" }));

    expect(onAbortWorkflowRun).toHaveBeenCalledTimes(1);
  });

  it("does not show abort control for terminal workflow sessions", () => {
    render(
      <SessionContextPanel
        selectedThread={workflowThread({ status: "FAILED" })}
        isAgentChatting={false}
        onOpenWorkspace={vi.fn()}
        onAbortWorkflowRun={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Abort Run" })).toBeNull();
  });
});
