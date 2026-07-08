import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { useWorkflowLifecycleResults } from "@/hooks/useWorkflows";
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflowLifecycleResults: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

vi.mock("@/components/budget/WorkItemCostEstimatePanel", () => ({
  WorkItemCostEstimatePanel: () => <div data-testid="cost-estimate-panel" />,
}));

vi.mock("./work-item-detail-sheet.hooks", () => ({
  useWorkItemFormState: () => ({
    title: "Test Item",
    description: "A description",
    priority: "p2",
    dependencyIds: [],
    isEditing: false,
    errors: {},
    setIsEditing: vi.fn(),
    setErrors: vi.fn(),
    resetFromItem: vi.fn(),
  }),
  useWorkItemRuns: () => ({
    currentRun: null,
    isCurrentRunLoading: false,
    executionHistory: [],
    isLoadingExecutionHistory: false,
  }),
  useWorkItemUpdateMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
  useResolveFeedbackMutation: () => ({
    mutate: vi.fn(),
  }),
  useRestartExecutionMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeleteWorkItemFlow: () => ({
    pendingDeleteItem: null,
    isDeleteDialogOpen: false,
    deleteError: null,
    deleteMutation: { isPending: false },
    requestDelete: vi.fn(),
    handleDialogOpenChange: vi.fn(),
    handleDelete: vi.fn(),
  }),
}));

const WORK_ITEM: WorkItem = {
  id: "item-1",
  project_id: "project-1",
  title: "Test Item",
  description: "A description",
  status: "todo",
  priority: "p2",
  type: "story",
  metadata: {},
  executionConfig: null,
  currentExecutionId: null,
  subtasks: [],
  dependencyIds: [],
  failedDeliverables: [],
  rejectionFeedback: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as WorkItem;

describe("WorkItemDetailSheet", () => {
  beforeEach(() => {
    vi.mocked(useWorkflowLifecycleResults).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useWorkflowLifecycleResults>);
  });

  it("renders the LifecycleResultsCard with the correct query when a work item is provided", () => {
    render(
      <WorkItemDetailSheet
        item={WORK_ITEM}
        allItems={[WORK_ITEM]}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByText("Lifecycle Results")).toBeTruthy();
    expect(useWorkflowLifecycleResults).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: "project-1",
        contextId: "item-1",
      }),
    );
  });

  it("does not render when item is null", () => {
    const { container } = render(
      <WorkItemDetailSheet
        item={null}
        allItems={[]}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
