import { describe, it, expect } from "vitest";
import { deriveGateState, readGateMarker } from "./kanban-gate-state";
import { WorkItem } from "@/lib/api/work-items.types";

const base = { id: "w1", status: "in-review" } as unknown as WorkItem;

describe("deriveGateState", () => {
  it("returns 'none' when there is no gate marker", () => {
    expect(deriveGateState(base, false)).toBe("none");
  });
  it("returns 'running' while a transition mutation is pending", () => {
    expect(deriveGateState(base, true)).toBe("running");
  });
  it("returns 'held' when metadata.lifecycle.gate is held", () => {
    const item = {
      ...base,
      metadata: {
        lifecycle: {
          gate: {
            status: "held",
            targetStatus: "ready-to-merge",
            failures: [],
          },
        },
      },
    } as WorkItem;
    expect(deriveGateState(item, false)).toBe("held");
  });
  it("reads the marker with its failures", () => {
    const item = {
      ...base,
      metadata: {
        lifecycle: {
          gate: {
            status: "held",
            targetStatus: "ready-to-merge",
            hook: "before",
            heldAt: "t",
            failures: [
              {
                workflowName: "e2e",
                status: "failed",
                error: null,
                runId: null,
              },
            ],
          },
        },
      },
    } as WorkItem;
    expect(readGateMarker(item)?.failures[0].workflowName).toBe("e2e");
  });
});
