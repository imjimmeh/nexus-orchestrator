import { describe, expect, it, vi } from "vitest";
import { ReviewService } from "./review.service";

type ReviewDecisionInput = {
  decision: "approve" | "reject";
  workflowId: string;
  requestedBy?: string;
};

describe("ReviewService", () => {
  it("routes approve and reject decisions through kanban-owned workflow requests", async () => {
    const workItems = {
      submitReviewDecision: vi.fn(
        (project_id: string, workItemId: string, input: ReviewDecisionInput) =>
          Promise.resolve({
            workItem: { id: workItemId, project_id },
            runId: `run-${input.decision}`,
            workflowId: input.workflowId,
          }),
      ),
    };
    const service = new ReviewService(workItems as never);

    await service.recordDecision({
      project_id: "project-1",
      workItemId: "item-1",
      decision: "approve",
      workflowId: "review-flow",
      requestedBy: "qa-agent",
    });
    await service.recordDecision({
      project_id: "project-1",
      workItemId: "item-2",
      decision: "reject",
      workflowId: "review-flow",
    });

    expect(workItems.submitReviewDecision).toHaveBeenNthCalledWith(
      1,
      "project-1",
      "item-1",
      {
        decision: "approve",
        workflowId: "review-flow",
        requestedBy: "qa-agent",
      },
    );
    expect(workItems.submitReviewDecision).toHaveBeenNthCalledWith(
      2,
      "project-1",
      "item-2",
      {
        decision: "reject",
        workflowId: "review-flow",
        requestedBy: undefined,
      },
    );
  });
});
