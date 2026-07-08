// packages/e2e-tests/src/fake-llm/__tests__/server.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeLlmServer, type FakeLlmServer } from "../server.js";
import { scenario, text, toolCall } from "../scenario.js";

let server: FakeLlmServer;

beforeEach(async () => {
  server = await createFakeLlmServer();
});

afterEach(async () => {
  await server.close();
});

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("createFakeLlmServer", () => {
  it("serves GET /v1/models", async () => {
    const res = await fetch(`${server.url}/v1/models`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data[0].id).toBeDefined();
  });

  it("returns a matched OpenAI tool call and records the request", async () => {
    server.loadScenario(
      scenario("s")
        .whenTool("lookup")
        .reply(toolCall("lookup", { q: "a" }))
        .otherwise(text("done")),
    );
    const res = await postJson("/v1/chat/completions", {
      model: "gpt-test",
      messages: [{ role: "user", content: "go" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
    });
    const json = (await res.json()) as {
      choices: Array<{ finish_reason: string }>;
    };
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(
      server.requests.lastFor("openai")?.tools.map((t) => t.name),
    ).toContain("lookup");
  });

  it("returns a matched Anthropic message via /v1/messages", async () => {
    server.loadScenario(scenario("s").otherwise(text("hi there")));
    const res = await postJson("/v1/messages", {
      model: "claude-test",
      messages: [{ role: "user", content: "go" }],
    });
    const json = (await res.json()) as { content: Array<{ text: string }> };
    expect(json.content[0].text).toBe("hi there");
    expect(server.requests.lastFor("anthropic")?.model).toBe("claude-test");
  });

  it("streams SSE when stream:true is requested", async () => {
    server.loadScenario(scenario("s").otherwise(text("streamed")));
    const res = await postJson("/v1/chat/completions", {
      model: "gpt-test",
      stream: true,
      messages: [{ role: "user", content: "go" }],
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const bodyText = await res.text();
    expect(bodyText).toContain('"content":"streamed"');
    expect(bodyText).toContain("data: [DONE]");
  });

  it("records unmatched requests and answers with the sentinel", async () => {
    server.loadScenario(scenario("empty"));
    await postJson("/v1/chat/completions", {
      model: "gpt-test",
      messages: [{ role: "user", content: "go" }],
    });
    expect(server.unmatched()).toHaveLength(1);
  });

  it("reset() clears both recorded and unmatched requests", async () => {
    server.loadScenario(scenario("empty"));
    await postJson("/v1/chat/completions", { model: "gpt-test", messages: [] });
    server.reset();
    expect(server.requests.count()).toBe(0);
    expect(server.unmatched()).toHaveLength(0);
  });
});
