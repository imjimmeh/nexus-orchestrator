import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { Dashboard } from "./Dashboard";

const mockState = vi.hoisted(() => ({
  runs: [] as WorkflowRun[],
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    getProjectOrchestrationState: vi.fn().mockResolvedValue({
      orchestration: null,
      projectState: {
        projectId: "project-1",
        totalCount: 0,
        activeCount: 0,
        groupedByStatus: {},
      },
      pendingActionRequests: [],
    }),
  },
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjectList: () => ({
    data: [
      {
        id: "project-1",
        name: "Broken Timestamp Project",
        updated_at: "not-a-date",
        created_at: "2026-03-24T12:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflowRuns: () => ({
    data: mockState.runs,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useAgentProfiles", () => ({
  useAgentProfiles: () => ({
    data: [],
    isLoading: false,
  }),
}));

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1aaaaaaa",
    workflow_id: "workflow-1",
    status: "RUNNING",
    state_variables: {},
    created_at: "2026-03-24T12:00:00.000Z",
    updated_at: "2026-03-24T12:00:00.000Z",
    ...overrides,
  } as WorkflowRun;
}

describe("Dashboard", () => {
  afterEach(() => {
    mockState.runs = [];
  });

  it("renders fallback copy when project or run timestamps are invalid", () => {
    mockState.runs = [buildRun({ started_at: "still-not-a-date" })];

    expect(() => renderDashboard()).not.toThrow();

    expect(screen.getByText("Broken Timestamp Project")).toBeTruthy();
    expect(screen.getByText("Updated recently")).toBeTruthy();
  });

  it("derives the run start time from created_at when started_at is absent", () => {
    mockState.runs = [
      buildRun({
        started_at: undefined,
        created_at: "2026-03-24T12:00:00.000Z",
      }),
    ];

    renderDashboard();

    // Both Activity Feed and Active Runs should show a relative time derived
    // from created_at, never the "Pending" / "just now" no-timestamp fallback.
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText(/just now/)).toBeNull();
    expect(screen.getAllByText(/ago/).length).toBeGreaterThan(0);
  });

  it("links active runs and activity-feed entries to the run detail page", () => {
    mockState.runs = [
      buildRun({ id: "run-1aaaaaaa", workflow_id: "workflow-1" }),
    ];

    renderDashboard();

    const expectedHref = "/workflows/workflow-1/runs/run-1aaaaaaa";
    const runLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === expectedHref);

    // One link from the Activity Feed widget, one from the Active Runs section.
    expect(runLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the run identifier inside its run-detail link", () => {
    mockState.runs = [
      buildRun({ id: "run-1aaaaaaa", workflow_id: "workflow-1" }),
    ];

    renderDashboard();

    const [runLink] = screen
      .getAllByRole("link")
      .filter(
        (link) =>
          link.getAttribute("href") ===
          "/workflows/workflow-1/runs/run-1aaaaaaa",
      );

    expect(within(runLink).getByText(/run-1aaa/)).toBeTruthy();
  });
});
