import { describe, it, expect } from "vitest";
import { ClaudeEventMapper } from "../src/map-claude-event.js";

describe("ClaudeEventMapper", () => {
  const mapper = new ClaudeEventMapper("step-1");

  it("maps an assistant tool_use block to tool_execution_start", () => {
    const out = mapper.map({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
      },
    });
    expect(out).toContainEqual({
      type: "tool_execution_start",
      stepId: "step-1",
      toolCallId: "t1",
      toolName: "Bash",
      args: { command: "ls" },
    });
  });

  it("maps a tool_result block (in user message) to tool_execution_end with isError", () => {
    const m = new ClaudeEventMapper("step-1");
    // First inject the tool_use so the id→name cache is populated
    m.map({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }],
      },
    });
    const out = m.map({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "err",
            is_error: true,
          },
        ],
      },
    });
    expect(out).toContainEqual(
      expect.objectContaining({
        type: "tool_execution_end",
        toolCallId: "t1",
        isError: true,
      }),
    );
  });

  it("maps a result message to agent_end", () => {
    const mapper3 = new ClaudeEventMapper("step-1");
    const out = mapper3.map({
      type: "result",
      subtype: "success",
      result: "done",
      usage: { output_tokens: 5 },
    });
    expect(out).toContainEqual(
      expect.objectContaining({
        type: "agent_end",
        output: expect.objectContaining({
          ok: true,
          response: "done",
          stopReason: "success",
        }),
      }),
    );
  });

  it("emits turn_start on the first assistant message", () => {
    const m = new ClaudeEventMapper("step-1");
    const out = m.map({ type: "assistant", message: { content: [] } });
    expect(out).toContainEqual({ type: "turn_start", stepId: "step-1" });
  });

  it("does not emit turn_start on subsequent assistant messages", () => {
    const m = new ClaudeEventMapper("step-1");
    m.map({ type: "assistant", message: { content: [] } });
    const out = m.map({ type: "assistant", message: { content: [] } });
    expect(out.filter((e) => e.type === "turn_start")).toHaveLength(0);
  });
});
