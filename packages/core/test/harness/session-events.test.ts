import { describe, it, expect } from "vitest";
import { CanonicalSessionEventSchema } from "../../src/schemas/harness/session-events.schema";

describe("CanonicalSessionEventSchema", () => {
  it("parses a tool_execution_start event", () => {
    const e = {
      type: "tool_execution_start",
      stepId: "step-1",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
    };
    expect(CanonicalSessionEventSchema.parse(e).type).toBe(
      "tool_execution_start",
    );
  });

  it("requires turn_end.output to carry ok/response/stopReason", () => {
    const ok = {
      type: "turn_end",
      stepId: "s",
      output: { ok: true, response: "done", stopReason: "end_turn" },
    };
    expect(() => CanonicalSessionEventSchema.parse(ok)).not.toThrow();

    const bad = { type: "turn_end", stepId: "s", output: { ok: true } };
    expect(() => CanonicalSessionEventSchema.parse(bad)).toThrow();
  });

  it("rejects an unknown event type", () => {
    expect(() =>
      CanonicalSessionEventSchema.parse({ type: "nope", stepId: "s" }),
    ).toThrow();
  });
});
