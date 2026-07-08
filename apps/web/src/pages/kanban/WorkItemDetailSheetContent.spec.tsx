import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkItemReadOnlyContent } from "./WorkItemDetailSheetContent";

vi.mock("@/components/budget/WorkItemCostEstimatePanel", () => ({
  WorkItemCostEstimatePanel: ({
    projectId,
    workItemId,
  }: Readonly<{ projectId: string; workItemId: string }>) => (
    <div data-testid="cost-estimate-panel">
      {projectId}:{workItemId}
    </div>
  ),
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
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
    ...overrides,
  } as unknown as WorkItem;
}

function renderReadOnlyContent(item: WorkItem, allItems: WorkItem[]) {
  return render(
    <WorkItemReadOnlyContent
      item={item}
      allItems={allItems}
      hasActiveSession={false}
      canMerge={false}
      canRestartExecution={false}
      isEditing={false}
      isRestartingExecution={false}
      isDeleting={false}
      currentRun={null}
      isCurrentRunLoading={false}
      executionHistory={[]}
      isLoadingExecutionHistory={false}
      mergeStatus={null}
      mergeReason={null}
      onStartEditing={vi.fn()}
      onOpenActiveSession={vi.fn()}
      onOpenCurrentRun={vi.fn()}
      onOpenHistoryRun={vi.fn()}
      onOpenMerge={vi.fn()}
      onRestartExecution={vi.fn()}
      onDelete={vi.fn()}
      onResolveFeedback={vi.fn()}
    />,
  );
}

describe("WorkItemReadOnlyContent split relationships", () => {
  it("renders generated child work items with progress and unloaded fallbacks", () => {
    const parent = makeWorkItem({
      id: "parent",
      title: "Umbrella Item",
      status: "blocked",
      metadata: {
        split: { proposedChildIds: ["done-child", "missing-child"] },
      },
    });
    const doneChild = makeWorkItem({
      id: "done-child",
      title: "Completed Child",
      status: "done",
    });

    renderReadOnlyContent(parent, [parent, doneChild]);

    expect(screen.getByText("Generated child work items")).toBeTruthy();
    expect(screen.getByText("1/2 done")).toBeTruthy();
    expect(screen.getByText("Completed Child")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("missing-child")).toBeTruthy();
    expect(screen.getByText("not currently loaded")).toBeTruthy();
    expect(screen.getByTestId("cost-estimate-panel").textContent).toBe(
      "project-1:parent",
    );
  });

  it("renders parent umbrella for canonical and legacy child metadata", () => {
    const parent = makeWorkItem({
      id: "parent",
      title: "Parent Umbrella",
      status: "blocked",
    });
    const canonicalChild = makeWorkItem({
      id: "canonical-child",
      metadata: { split: { parentId: "parent" } },
    });
    const legacyChild = makeWorkItem({
      id: "legacy-child",
      metadata: { parent_context_id: "parent" },
    });

    const { rerender } = renderReadOnlyContent(canonicalChild, [parent]);

    expect(screen.getByText("Parent umbrella")).toBeTruthy();
    expect(screen.getByText("Parent Umbrella")).toBeTruthy();
    expect(screen.getByText("blocked")).toBeTruthy();

    rerender(
      <WorkItemReadOnlyContent
        item={legacyChild}
        allItems={[parent]}
        hasActiveSession={false}
        canMerge={false}
        canRestartExecution={false}
        isEditing={false}
        isRestartingExecution={false}
        isDeleting={false}
        currentRun={null}
        isCurrentRunLoading={false}
        executionHistory={[]}
        isLoadingExecutionHistory={false}
        mergeStatus={null}
        mergeReason={null}
        onStartEditing={vi.fn()}
        onOpenActiveSession={vi.fn()}
        onOpenCurrentRun={vi.fn()}
        onOpenHistoryRun={vi.fn()}
        onOpenMerge={vi.fn()}
        onRestartExecution={vi.fn()}
        onDelete={vi.fn()}
        onResolveFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("Parent umbrella")).toBeTruthy();
    expect(screen.getByText("Parent Umbrella")).toBeTruthy();
  });
});
