import { describe, it, expect } from "vitest";
import { ClaudeV3Mapper } from "../src/map-claude-message-to-v3.js";

const ctx = { provider: "anthropic", model: "claude-sonnet-4-6" };

describe("ClaudeV3Mapper", () => {
  it("maps an assistant message with text + tool_use into one v3 assistant message node", () => {
    const mapper = new ClaudeV3Mapper(ctx);
    const nodes = mapper.map({
      type: "assistant",
      message: {
        id: "resp_1",
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
        content: [
          { type: "text", text: "Calling a tool" },
          {
            type: "tool_use",
            id: "call_1",
            name: "kanban_project_state",
            input: { max: 100 },
          },
        ],
      },
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "message" });
    const msg = (nodes[0] as { message: Record<string, unknown> }).message;
    expect(msg).toMatchObject({
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      stopReason: "tool_use",
      responseId: "resp_1",
    });
    expect(msg.content).toEqual([
      { type: "text", text: "Calling a tool" },
      {
        type: "toolCall",
        id: "call_1",
        name: "kanban_project_state",
        arguments: { max: 100 },
      },
    ]);
    expect(msg.usage).toMatchObject({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 15,
    });
  });

  it("maps a thinking block into an inline <think> text block", () => {
    const mapper = new ClaudeV3Mapper(ctx);
    const nodes = mapper.map({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "reasoning" }] },
    });
    const msg = (nodes[0] as { message: { content: unknown[] } }).message;
    expect(msg.content[0]).toEqual({
      type: "text",
      text: "<think>\nreasoning\n</think>",
    });
  });

  it("maps a user tool_result block into a toolResult node carrying the cached tool name", () => {
    const mapper = new ClaudeV3Mapper(ctx);
    mapper.map({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "kanban_get_charter",
            input: {},
          },
        ],
      },
    });
    const nodes = mapper.map({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: "charter text",
            is_error: false,
          },
        ],
      },
    });
    expect(nodes).toHaveLength(1);
    expect(
      (nodes[0] as { message: Record<string, unknown> }).message,
    ).toMatchObject({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "kanban_get_charter",
      content: [{ type: "text", text: "charter text" }],
    });
  });

  it("maps a user text message into a v3 user message node", () => {
    const mapper = new ClaudeV3Mapper(ctx);
    const nodes = mapper.map({
      type: "user",
      message: { content: [{ type: "text", text: "do the thing" }] },
    });
    expect((nodes[0] as { message: Record<string, unknown> }).message).toEqual({
      role: "user",
      content: [{ type: "text", text: "do the thing" }],
    });
  });

  it("emits no nodes for a result message (no v3 equivalent)", () => {
    const mapper = new ClaudeV3Mapper(ctx);
    expect(
      mapper.map({ type: "result", subtype: "success", result: "done" }),
    ).toEqual([]);
  });
});
