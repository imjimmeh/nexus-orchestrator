import { describe, expect, it } from "vitest";
import {
  formatRunningWorkflowsSummary,
  type RunningWorkflowSummary,
} from "../running-workflow-summary.types";

const baseSummary: RunningWorkflowSummary = {
  runId: "run-1",
  workflowName: "Project Backlog Generation (CEO)",
  status: "RUNNING",
  ageSeconds: 125,
};

describe("formatRunningWorkflowsSummary", () => {
  it("returns an empty string when nothing is active", () => {
    expect(formatRunningWorkflowsSummary([])).toBe("");
  });

  it("renders a header with the total count and one line per run", () => {
    const result = formatRunningWorkflowsSummary([
      baseSummary,
      { ...baseSummary, runId: "run-2", status: "PENDING", ageSeconds: 10 },
    ]);

    expect(result).toContain("Workflows already running for this scope (2):");
    expect(result).toContain("Project Backlog Generation (CEO) [RUNNING, 2m]");
    expect(result).toContain("[PENDING, 10s]");
    expect(result).toContain("run run-1");
  });

  it("surfaces wait reason and parent linkage when present", () => {
    const result = formatRunningWorkflowsSummary([
      {
        ...baseSummary,
        waitReason: "dependency",
        parentRunId: "cycle-run-9",
      },
    ]);

    expect(result).toContain("waiting on dependency");
    expect(result).toContain("child of run cycle-run-9");
  });

  it("formats age as hours past one hour", () => {
    const result = formatRunningWorkflowsSummary([
      { ...baseSummary, ageSeconds: 7200 },
    ]);

    expect(result).toContain("[RUNNING, 2h]");
  });

  it("caps the list at the limit and reports the hidden remainder", () => {
    const many: RunningWorkflowSummary[] = Array.from(
      { length: 5 },
      (_, i) => ({
        ...baseSummary,
        runId: `run-${i}`,
      }),
    );

    const result = formatRunningWorkflowsSummary(many, 2);

    expect(result).toContain("Workflows already running for this scope (5):");
    expect(result).toContain("…and 3 more not shown");
    expect(result).toContain("list_running_workflows");
    expect(result.match(/^- /gm) ?? []).toHaveLength(2);
  });
});
