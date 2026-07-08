import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { WorkflowRunContextStrip } from "./WorkflowRunContextStrip";

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-queued",
    workflow_id: "workflow-1",
    status: "COMPLETED",
    state_variables: {},
    created_at: "2026-04-07T10:00:00.000Z",
    updated_at: "2026-04-07T10:00:00.000Z",
    ...overrides,
  } as WorkflowRun;
}

describe("WorkflowRunContextStrip", () => {
  it("renders the active run with executing text and a workflow run link", () => {
    render(
      <MemoryRouter>
        <WorkflowRunContextStrip
          workflowId="workflow-1"
          runs={[buildRun({ id: "run-running", status: "RUNNING" })]}
          selectedRunId="run-running"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Currently executing run")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "run-running" }).getAttribute("href"),
    ).toBe("/workflows/workflow-1/runs/run-running");
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("renders viewing text for a completed selected run", () => {
    render(
      <MemoryRouter>
        <WorkflowRunContextStrip
          workflowId="workflow-1"
          runs={[buildRun()]}
          selectedRunId="run-queued"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Viewing run")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("changes the selected run from the native select", () => {
    const onRunChange = vi.fn();

    render(
      <MemoryRouter>
        <WorkflowRunContextStrip
          workflowId="workflow-1"
          runs={[
            buildRun({ id: "run-1", status: "COMPLETED" }),
            buildRun({ id: "run-2", status: "RUNNING" }),
          ]}
          selectedRunId="run-1"
          onRunChange={onRunChange}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "run-2" },
    });

    expect(onRunChange).toHaveBeenCalledWith("run-2");
  });

  it("renders an empty state when no run is selected", () => {
    render(
      <MemoryRouter>
        <WorkflowRunContextStrip workflowId="workflow-1" runs={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByText("No workflow run selected")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders an empty state when the selected run is missing from the fetched runs", () => {
    render(
      <MemoryRouter>
        <WorkflowRunContextStrip
          workflowId="workflow-1"
          runs={[buildRun({ id: "run-1" }), buildRun({ id: "run-2" })]}
          selectedRunId="run-missing"
          onRunChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("No workflow run selected")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
