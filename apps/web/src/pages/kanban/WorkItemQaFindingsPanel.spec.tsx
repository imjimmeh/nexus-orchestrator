import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkItemQaFindingsPanel } from "./WorkItemQaFindingsPanel";

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

describe("WorkItemQaFindingsPanel", () => {
  it("renders nothing when there is no QA feedback and no rejection count", () => {
    const { container } = render(
      <WorkItemQaFindingsPanel item={buildWorkItem()} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for whitespace-only string QA feedback without rejection count", () => {
    const { container } = render(
      <WorkItemQaFindingsPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            rejectionFeedback: "   \n\t  ",
          },
        })}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders structured QA rejection findings", () => {
    render(
      <WorkItemQaFindingsPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            rejectionCount: 2,
            rejectionFeedback: {
              feedback: "Needs fixes before merge.",
              failedDeliverables: [
                {
                  deliverable_id: "D-17",
                  failure_type: "incomplete",
                  details: "Missing integration coverage.",
                  affected_files: ["apps/web/src/pages/kanban/KanbanPage.tsx"],
                },
              ],
            },
          },
        })}
      />,
    );

    expect(screen.getByText("QA Review Findings")).toBeTruthy();
    expect(screen.getByText("Needs fixes before merge.")).toBeTruthy();
    expect(screen.getByText("Rejection count: 2")).toBeTruthy();
    expect(screen.getByText("D-17")).toBeTruthy();
    expect(screen.getByText("incomplete")).toBeTruthy();
    expect(screen.getByText("Missing integration coverage.")).toBeTruthy();
    expect(
      screen.getByText("apps/web/src/pages/kanban/KanbanPage.tsx"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Next step: Address failed deliverables before resubmitting.",
      ),
    ).toBeTruthy();
  });

  it("redacts secret and raw-output labels from feedback and deliverable details", () => {
    render(
      <WorkItemQaFindingsPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            rejectionFeedback: {
              feedback: "authorization bearer token leaked in feedback",
              failedDeliverables: [
                {
                  deliverable_id: "D-19",
                  failure_type: "incorrect",
                  details: "job-output included raw command logs",
                  affected_files: [],
                },
                {
                  deliverable_id: "D-20",
                  failure_type: "test_failure",
                  details: "full transcript included in QA details",
                  affected_files: [],
                },
              ],
            },
          },
        })}
      />,
    );

    expect(screen.getAllByText("[REDACTED]")).toHaveLength(3);
    expect(screen.queryByText(/authorization bearer token/)).toBeNull();
    expect(screen.queryByText(/job-output/)).toBeNull();
    expect(screen.queryByText(/full transcript/)).toBeNull();
  });

  it("ignores malformed affected files without crashing", () => {
    render(
      <WorkItemQaFindingsPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            rejectionFeedback: {
              feedback: "Malformed affected files should not crash.",
              failedDeliverables: [
                {
                  deliverable_id: "D-18",
                  failure_type: "incorrect",
                  details: "Affected files should be an array.",
                  affected_files: "file.ts",
                },
              ],
            } as unknown as WorkItem["executionConfig"] extends infer Config
              ? Config extends { rejectionFeedback?: infer Feedback }
                ? Feedback
                : never
              : never,
          },
        })}
      />,
    );

    expect(screen.getByText("D-18")).toBeTruthy();
    expect(screen.queryByText("file.ts")).toBeNull();
  });

  it("does not render arbitrary unknown rejection feedback fields", () => {
    render(
      <WorkItemQaFindingsPanel
        item={buildWorkItem({
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/sample",
            contextFiles: [],
            documentationUrls: [],
            rejectionCount: 1,
            rejectionFeedback: {
              feedback: "Known feedback only.",
              secretInternalNote: "Do not show this unknown field.",
            } as WorkItem["executionConfig"] extends infer Config
              ? Config extends { rejectionFeedback?: infer Feedback }
                ? Feedback
                : never
              : never,
          },
        })}
      />,
    );

    expect(screen.getByText("Known feedback only.")).toBeTruthy();
    expect(screen.queryByText("Do not show this unknown field.")).toBeNull();
  });
});
