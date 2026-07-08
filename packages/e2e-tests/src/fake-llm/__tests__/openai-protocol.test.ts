// packages/e2e-tests/src/fake-llm/__tests__/openai-protocol.test.ts
import { describe, expect, it } from "vitest";
import { parseOpenAiRequest } from "../protocols/openai-parse.js";
import {
  serializeOpenAiResponse,
  serializeOpenAiSse,
} from "../protocols/openai-serialize.js";
import { text, toolCall } from "../scenario.js";

describe("parseOpenAiRequest", () => {
  it("flattens system, last user text, tools, and resolves tool-result names", () => {
    const body = {
      model: "gpt-test",
      stream: true,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"result":42}' },
      ],
      tools: [
        {
          type: "function",
          function: { name: "lookup", description: "looks up" },
        },
      ],
    };
    const parsed = parseOpenAiRequest(body, { authorization: "Bearer x" });
    expect(parsed.protocol).toBe("openai");
    expect(parsed.model).toBe("gpt-test");
    expect(parsed.system).toBe("You are helpful.");
    expect(parsed.stream).toBe(true);
    expect(parsed.tools).toEqual([{ name: "lookup", description: "looks up" }]);
    const toolMessage = parsed.messages.find((m) => m.role === "tool");
    expect(toolMessage?.toolName).toBe("lookup");
    expect(parsed.headers.authorization).toBe("Bearer x");
  });
});

describe("serializeOpenAiResponse", () => {
  it("renders a text completion", () => {
    const out = serializeOpenAiResponse([text("hello")], "gpt-test", 1);
    expect(out.choices[0].message.content).toBe("hello");
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.object).toBe("chat.completion");
  });

  it("renders tool calls with stringified arguments", () => {
    const out = serializeOpenAiResponse(
      [toolCall("lookup", { q: "a" })],
      "gpt-test",
      2,
    );
    expect(out.choices[0].finish_reason).toBe("tool_calls");
    const call = out.choices[0].message.tool_calls?.[0];
    expect(call?.function.name).toBe("lookup");
    expect(JSON.parse(call?.function.arguments ?? "{}")).toEqual({ q: "a" });
  });
});

describe("serializeOpenAiSse", () => {
  it("emits content delta then a stop chunk and [DONE] for text", () => {
    const sse = serializeOpenAiSse([text("hi")], "gpt-test", 3);
    expect(sse).toContain('"content":"hi"');
    expect(sse).toContain('"finish_reason":"stop"');
    expect(sse.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("emits tool-call name then argument delta then tool_calls stop for tool calls", () => {
    const sse = serializeOpenAiSse(
      [toolCall("lookup", { q: "a" })],
      "gpt-test",
      4,
    );
    expect(sse).toContain('"name":"lookup"');
    expect(sse).toContain('"arguments":"{\\"q\\":\\"a\\"}"');
    expect(sse).toContain('"finish_reason":"tool_calls"');
  });
});
