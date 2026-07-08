import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OrchestrationStatusCard } from "./OrchestrationStatusCard";
import { ProjectOrchestration, ProjectStateSnapshot } from "@/lib/api/projects.types";
import { WorkflowRun } from "@/lib/api/workflows.types";

function buildOrchestration(
  overrides: Partial<ProjectOrchestration> = {},
): ProjectOrchestration {
  return {
    id: "orch-1",
    project_id: "project-1",
    status: "initializing",
    goals: "Ship a todo app",
    revisionFeedback: null,
    orchestrationMode: "supervised",
    strategySummary: null,
    currentWorkflowRunId: null,
    decisionLog: [],
    metadata: null,
    created_at: "2026-04-05T08:00:00.000Z",
    updated_at: "2026-04-05T08:00:00.000Z",
    ...overrides,
  };
}

function buildProjectState(): ProjectStateSnapshot {
  return {
    project_id: "project-1",
    totalCount: 0,
    activeCount: 0,
    groupedByStatus: {},
  };
}

function buildWorkflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-123",
    workflow_id: "workflow-1",
    status: "RUNNING",
    current_step_id: "discovery_and_specs",
    state_variables: {},
    started_at: "2026-04-05T09:00:00.000Z",
    completed_at: null,
    created_at: "2026-04-05T09:00:00.000Z",
    updated_at: "2026-04-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("OrchestrationStatusCard", () => {
  it("shows fallback workflow run id when orchestration has no linked run id yet", () => {
    render(
      <MemoryRouter>
        <OrchestrationStatusCard
          orchestration={buildOrchestration({ currentWorkflowRunId: null })}
          projectState={buildProjectState()}
          workflowRun={buildWorkflowRun()}
          workflowEvents={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Current run: run-123")).toBeTruthy();
    expect(screen.queryByText("No active workflow run")).toBeNull();
  });

  it("shows no active run when no linked id and no workflow run are available", () => {
    render(
      <MemoryRouter>
        <OrchestrationStatusCard
          orchestration={buildOrchestration({ currentWorkflowRunId: null })}
          projectState={buildProjectState()}
          workflowRun={null}
          workflowEvents={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Current run: No active run")).toBeTruthy();
    expect(screen.getByText("No active workflow run")).toBeTruthy();
  });

  it("renders direct run session link when workflow run details are available", () => {
    render(
      <MemoryRouter>
        <OrchestrationStatusCard
          orchestration={buildOrchestration()}
          projectState={buildProjectState()}
          workflowRun={buildWorkflowRun({
            id: "run-abc",
            workflow_id: "workflow-xyz",
          })}
          workflowEvents={[]}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Open Workflow Run" });
    expect(link.getAttribute("href")).toBe(
      "/workflows/workflow-xyz/runs/run-abc",
    );
  });

  it("renders go to active session link when work item context is available", () => {
    render(
      <MemoryRouter>
        <OrchestrationStatusCard
          orchestration={buildOrchestration()}
          projectState={buildProjectState()}
          workflowRun={buildWorkflowRun()}
          workflowEvents={[]}
          activeSessionHref="/projects/project-123/work-items/work-item-77/active-session"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Go to Active Session" });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-123/work-items/work-item-77/active-session",
    );
  });

  it("renders go to active session link for run-scoped session route", () => {
    render(
      <MemoryRouter>
        <OrchestrationStatusCard
          orchestration={buildOrchestration()}
          projectState={buildProjectState()}
          workflowRun={buildWorkflowRun({ id: "run-999" })}
          workflowEvents={[]}
          activeSessionHref="/projects/project-123/runs/run-999/active-session"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Go to Active Session" });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-123/runs/run-999/active-session",
    );
  });
});
