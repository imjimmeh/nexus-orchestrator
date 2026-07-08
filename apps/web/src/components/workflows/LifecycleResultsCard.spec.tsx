import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowLifecycleResults } from "@/hooks/useWorkflows";
import { LifecycleResultsCard } from "./LifecycleResultsCard";

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflowLifecycleResults: vi.fn(),
}));

describe("LifecycleResultsCard", () => {
  beforeEach(() => {
    vi.mocked(useWorkflowLifecycleResults).mockReturnValue({
      data: [
        {
          id: "result-1",
          scope_id: "scope-1",
          context_id: "context-1",
          phase: "review",
          hook: "before_transition",
          blocking_only: true,
          aggregate_status: "passed",
          repository_ref: "refs/heads/main",
          results: [
            {
              workflowId: "workflow-1",
              workflowName: "Repository CI",
              phase: "review",
              hook: "before_transition",
              blocking: true,
              status: "passed",
              runId: "run-1",
            },
          ],
          created_at: "2026-06-05T10:00:00.000Z",
          updated_at: "2026-06-05T10:00:00.000Z",
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useWorkflowLifecycleResults>);
  });

  it("renders lifecycle aggregate status and workflow results", () => {
    render(
      <LifecycleResultsCard
        query={{ scopeId: "scope-1", contextId: "context-1" }}
      />,
    );

    expect(useWorkflowLifecycleResults).toHaveBeenCalledWith({
      scopeId: "scope-1",
      contextId: "context-1",
    });
    expect(screen.getByText("Lifecycle Results")).toBeTruthy();
    expect(screen.getAllByText("passed").length).toBeGreaterThan(0);
    expect(screen.getByText("Repository CI")).toBeTruthy();
    expect(screen.getAllByText("before_transition").length).toBeGreaterThan(0);
  });

  it("renders an empty state when no lifecycle results exist", () => {
    vi.mocked(useWorkflowLifecycleResults).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useWorkflowLifecycleResults>);

    render(<LifecycleResultsCard query={{ scopeId: "scope-1" }} />);

    expect(screen.getByText("No lifecycle results recorded")).toBeTruthy();
  });
});
