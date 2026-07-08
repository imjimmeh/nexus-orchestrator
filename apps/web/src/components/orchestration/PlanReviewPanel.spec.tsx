import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { PlanReviewPanel } from "./PlanReviewPanel";

function buildWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WI-1",
    project_id: "project-1",
    title: "Sample work item",
    description: "Implement the feature",
    status: "in-review",
    type: "story",
    priority: "medium",
    created_at: "2026-04-29T00:00:00.000Z",
    updated_at: "2026-04-29T00:00:00.000Z",
    executionConfig: {
      baseBranch: "main",
      targetBranch: "feature/sample",
      contextFiles: [],
      documentationUrls: [],
    },
    ...overrides,
  };
}

describe("PlanReviewPanel", () => {
  it("redacts unsafe reviewer feedback and failed-deliverable details", () => {
    render(
      <PlanReviewPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            implementationPlan: { steps: ["Do the thing"] },
            rejectionCount: 1,
            rejectionFeedback: {
              feedback: "authorization bearer token leaked in feedback",
              failedDeliverables: [
                {
                  deliverable_id: "D-19",
                  failure_type: "incorrect",
                  details: "job-output included raw command logs",
                  affected_files: [],
                },
              ],
            },
          },
        })}
      />,
    );

    expect(screen.getAllByText("[REDACTED]")).toHaveLength(2);
    expect(screen.queryByText(/authorization bearer token/)).toBeNull();
    expect(screen.queryByText(/job-output/)).toBeNull();
  });

  it("redacts unsafe content embedded in the implementation plan JSON dump", () => {
    render(
      <PlanReviewPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            implementationPlan: {
              steps: ["Call the API using a bearer token for auth"],
            },
          },
        })}
      />,
    );

    expect(screen.queryByText(/bearer token/)).toBeNull();
    expect(screen.getByText("[REDACTED]")).toBeInTheDocument();
  });
});
