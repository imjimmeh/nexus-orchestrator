import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOrchestrationActionRequest, ProjectOrchestrationDecisionEntry, ProjectOrchestrationState } from "@/lib/api/projects.types";
import { WorkItem } from "@/lib/api/work-items.types";
import { DispatchTab } from "./DispatchTab";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));

const PROJECT_ID = "project-123";

function createDispatchDecision(
  timestamp: string,
): ProjectOrchestrationDecisionEntry {
  return {
    timestamp,
    type: "action_executed",
    reasoning: "Started prioritized todo work item wi-1",
    actions: ["dispatch_start_work_items"],
    requestedAction: "dispatch_start_work_items",
    modeEvaluation: "allow",
    executionStatus: "executed",
    correlationId: "corr-1",
  };
}

function createOrchestrationState(params: {
  decisionLog?: ProjectOrchestrationDecisionEntry[];
  pendingActionRequests?: ProjectOrchestrationActionRequest[];
}): ProjectOrchestrationState {
  return {
    orchestration: {
      id: "orch-1",
      project_id: PROJECT_ID,
      status: "orchestrating",
      goals: "Ship feature",
      revisionFeedback: null,
      orchestrationMode: "autonomous",
      strategySummary: null,
      currentWorkflowRunId: null,
      decisionLog: params.decisionLog ?? [],
      metadata: null,
      created_at: "2026-04-01T12:00:00.000Z",
      updated_at: "2026-04-01T12:00:00.000Z",
    },
    projectState: {
      project_id: PROJECT_ID,
      totalCount: 0,
      activeCount: 0,
      groupedByStatus: {},
    },
    pendingActionRequests: params.pendingActionRequests ?? [],
  };
}

function mockQueries(
  state: ProjectOrchestrationState,
  workItems: WorkItem[] = [],
): void {
  useQueryMock.mockImplementation((input: { queryKey: unknown[] }) => {
    const [scope] = input.queryKey;

    if (scope === "project-orchestration") {
      return {
        data: state,
        isLoading: false,
      };
    }

    if (scope === "project-work-items") {
      return {
        data: workItems,
        isLoading: false,
      };
    }

    return {
      data: [],
      isLoading: false,
    };
  });
}

describe("DispatchTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dispatch decisions from orchestration decision log", () => {
    mockQueries(
      createOrchestrationState({
        decisionLog: [createDispatchDecision("2026-04-01T12:00:00.000Z")],
      }),
    );

    render(
      <MemoryRouter>
        <DispatchTab projectId={PROJECT_ID} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText(
        "No dispatch decisions recorded for this project yet.",
      ),
    ).toBeNull();
    expect(screen.getByText("Dispatch Executed")).toBeTruthy();
    expect(
      screen.getByText("Started prioritized todo work item wi-1"),
    ).toBeTruthy();
  });

  it("keeps empty state when no dispatch decisions exist", () => {
    mockQueries(
      createOrchestrationState({
        decisionLog: [
          {
            timestamp: "2026-04-01T12:00:00.000Z",
            type: "analysis",
            reasoning: "No dispatch required.",
            actions: ["update_project_strategy"],
            requestedAction: "update_project_strategy",
            modeEvaluation: "allow",
            executionStatus: "executed",
            correlationId: "corr-analysis",
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <DispatchTab projectId={PROJECT_ID} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No dispatch decisions recorded for this project yet."),
    ).toBeTruthy();
  });
});
