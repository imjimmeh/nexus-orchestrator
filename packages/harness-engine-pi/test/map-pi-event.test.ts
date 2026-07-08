import { describe, it, expect } from "vitest";
import { mapPiEventToCanonical } from "../src/map-pi-event.js";

describe("mapPiEventToCanonical", () => {
  it("maps a tool_execution_start AgentSession event", () => {
    const out = mapPiEventToCanonical(
      {
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "bash",
        args: { command: "ls" },
      },
      "step-1",
    );
    expect(out).toEqual({
      type: "tool_execution_start",
      stepId: "step-1",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "ls" },
    });
  });

  it("restores original tool names when a reverse sanitization map is provided", () => {
    const reverseNameMap = new Map([
      ["kanban_project_state", "kanban.project_state"],
    ]);
    const out = mapPiEventToCanonical(
      {
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "kanban_project_state",
        args: {},
      },
      "step-1",
      reverseNameMap,
    );
    expect(out).toEqual({
      type: "tool_execution_start",
      stepId: "step-1",
      toolCallId: "c1",
      toolName: "kanban.project_state",
      args: {},
    });
  });

  it("maps turn_end populating output.ok/response/stopReason", () => {
    const out = mapPiEventToCanonical(
      { type: "turn_end", message: { stopReason: "end_turn", text: "done" } },
      "step-1",
    );
    expect(out).toMatchObject({
      type: "turn_end",
      output: { ok: true, response: "done", stopReason: "end_turn" },
    });
  });
});
