// packages/e2e-tests/src/fake-llm/__tests__/anthropic-protocol.test.ts
import { describe, expect, it } from "vitest";
import { parseAnthropicRequest } from "../protocols/anthropic-parse.js";
import {
  serializeAnthropicResponse,
  serializeAnthropicSse,
} from "../protocols/anthropic-serialize.js";
import { text, toolCall } from "../scenario.js";

describe("parseAnthropicRequest", () => {
  it("flattens string + array system, blocks, tools and resolves tool_result names", () => {
    const body = {
      model: "claude-test",
      stream: false,
      system: [{ type: "text", text: "You are helpful." }],
      tools: [
        {
          name: "lookup",
          description: "looks up",
          input_schema: { type: "object" },
        },
      ],
      messages: [
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "lookup", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: '{"result":42}',
            },
          ],
        },
      ],
    };
    const parsed = parseAnthropicRequest(body, { "x-api-key": "k" });
    expect(parsed.protocol).toBe("anthropic");
    expect(parsed.model).toBe("claude-test");
    expect(parsed.system).toBe("You are helpful.");
    expect(parsed.tools).toEqual([{ name: "lookup", description: "looks up" }]);
    expect(parsed.messages.find((m) => m.role === "user")?.text).toBe(
      "do the thing",
    );
    const toolMessage = parsed.messages.find((m) => m.role === "tool");
    expect(toolMessage?.toolName).toBe("lookup");
    expect(parsed.headers["x-api-key"]).toBe("k");
  });
});

describe("serializeAnthropicResponse", () => {
  it("renders a text message with end_turn", () => {
    const out = serializeAnthropicResponse([text("hello")], "claude-test", 1);
    expect(out.type).toBe("message");
    expect(out.content).toEqual([{ type: "text", text: "hello" }]);
    expect(out.stop_reason).toBe("end_turn");
  });

  it("renders a tool_use message with tool_use stop reason", () => {
    const out = serializeAnthropicResponse(
      [toolCall("lookup", { q: "a" })],
      "claude-test",
      2,
    );
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content[0]).toMatchObject({
      type: "tool_use",
      name: "lookup",
      input: { q: "a" },
    });
  });
});

describe("serializeAnthropicSse", () => {
  it("emits the full text event sequence ending in message_stop", () => {
    const sse = serializeAnthropicSse([text("hi")], "claude-test", 3);
    expect(sse).toContain("event: message_start");
    expect(sse).toContain('"type":"text_delta","text":"hi"');
    expect(sse).toContain('"stop_reason":"end_turn"');
    expect(sse.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(true);
  });

  it("emits input_json_delta and tool_use stop reason for tool calls", () => {
    const sse = serializeAnthropicSse(
      [toolCall("lookup", { q: "a" })],
      "claude-test",
      4,
    );
    expect(sse).toContain('"type":"tool_use"');
    expect(sse).toContain('"type":"input_json_delta"');
    expect(sse).toContain('"stop_reason":"tool_use"');
  });
});
