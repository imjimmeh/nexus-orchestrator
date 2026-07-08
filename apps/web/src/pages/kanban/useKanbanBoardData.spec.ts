import { describe, expect, it } from "vitest";
import {
  buildStatusUpdateErrorNotice,
  buildStatusUpdateSuccessNotice,
  parseStatusUpdateResult,
} from "./useKanbanBoardData";
import { WorkItem } from "@/lib/api/work-items.types";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Test item",
    status: "blocked",
    type: "story",
    priority: "p2",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("parseStatusUpdateResult", () => {
  it("parses canonical status update payload", () => {
    const workItem = makeWorkItem({ status: "ready-to-merge" });
    const result = parseStatusUpdateResult({
      workItem,
      triggeredRunIds: ["run-1", 2, "run-2"],
    });

    expect(result).toEqual({
      workItem,
      triggeredRunIds: ["run-1", "run-2"],
    });
  });

  it("parses nested envelope payload", () => {
    const workItem = makeWorkItem({ id: "wi-2", status: "in-review" });
    const result = parseStatusUpdateResult({
      data: {
        workItem,
        triggeredRunIds: ["run-3"],
      },
    });

    expect(result).toEqual({
      workItem,
      triggeredRunIds: ["run-3"],
    });
  });

  it("accepts direct work item payload with empty run ids", () => {
    const workItem = makeWorkItem({ id: "wi-3", status: "done" });
    const result = parseStatusUpdateResult(workItem);

    expect(result).toEqual({
      workItem,
      triggeredRunIds: [],
    });
  });

  it("returns null for malformed payloads", () => {
    expect(parseStatusUpdateResult(null)).toBeNull();
    expect(parseStatusUpdateResult({ triggeredRunIds: ["run-1"] })).toBeNull();
    expect(parseStatusUpdateResult({ workItem: { id: "x" } })).toBeNull();
  });
});

describe("buildStatusUpdateSuccessNotice", () => {
  it("explains when a manual in-progress move bypasses readiness rerouting", () => {
    const result = {
      workItem: makeWorkItem({ status: "in-progress" }),
      triggeredRunIds: ["run-1"],
    };

    expect(
      buildStatusUpdateSuccessNotice({
        result,
        variables: {
          workItemId: "wi-1",
          status: "in-progress",
          bypassReadinessGates: true,
        },
      }),
    ).toEqual({
      kind: "info",
      message:
        "Moved to in-progress manually. Direct board moves bypass readiness rerouting; automation for the target status still runs normally.",
    });
  });

  it("falls back to the no-automation notice when nothing triggered", () => {
    const result = {
      workItem: makeWorkItem({ status: "blocked" }),
      triggeredRunIds: [],
    };

    expect(
      buildStatusUpdateSuccessNotice({
        result,
        variables: {
          workItemId: "wi-1",
          status: "blocked",
        },
      }),
    ).toEqual({
      kind: "info",
      message:
        "Status changed to blocked, but no workflow automation was triggered for this status.",
    });
  });
});

describe("buildStatusUpdateErrorNotice", () => {
  it("surfaces a held-gate 409 as a blocking-move notice", () => {
    const gateError = {
      response: {
        status: 409,
        data: {
          code: "LIFECYCLE_GATE_BLOCKED",
          message: "Transition blocked: e2e: failed",
        },
      },
    };

    expect(buildStatusUpdateErrorNotice(gateError)).toEqual({
      kind: "error",
      message: "Move blocked by checks: Transition blocked: e2e: failed",
      refetch: true,
    });
  });

  it("returns a generic error notice for non-gate errors", () => {
    expect(buildStatusUpdateErrorNotice(new Error("Network error"))).toEqual({
      kind: "error",
      message: "Network error",
      refetch: false,
    });
  });

  it("returns a fallback notice for unrecognised error shapes", () => {
    expect(buildStatusUpdateErrorNotice({ response: { status: 500 } })).toEqual(
      {
        kind: "error",
        message: "Unable to move work item to the selected status.",
        refetch: false,
      },
    );
  });
});
