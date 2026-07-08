# 44 — Fake LLM Server

> Part of the deterministic E2E harness (subsystem 1 of 3). Provides an in-process HTTP server that speaks both the OpenAI and Anthropic wire protocols, returns scripted responses matched by declarative rules, and records every request so tests can make precise assertions about what the system sent to the model.

Cross-links: [31-packages.md](31-packages.md) · [02-getting-started.md](02-getting-started.md)

---

## Why a fake LLM server?

Real LLM inference is non-deterministic, slow, and costly. E2E tests that exercise the full Nexus stack — API, queues, containers, agent steps — need a drop-in replacement for the AI provider endpoint so that:

- Test scenarios produce the same tool calls and text responses every run.
- No provider API keys are required in CI.
- Tests can assert the exact prompt, system message, and tool list sent to the model.
- Both JSON and SSE streaming code paths in the API and container runtime are exercised.

The fake LLM server is a lightweight Node `http` server that lives in `packages/e2e-tests/src/fake-llm/`. It is written in strict TypeScript (NodeNext ESM) and introduces no new dependencies.

---

## Architecture overview

```
packages/e2e-tests/src/fake-llm/
  types.ts                          Canonical types: CanonicalRequest, Turn, Rule, Scenario, RecordedRequest
  recorder.ts                       In-memory request log with query helpers
  matcher.ts                        matchesRule() + selectResponse()
  scenario.ts                       scenario() builder, text()/toolCall() factories, type guards
  protocols/
    openai-parse.ts                 OpenAI body → CanonicalRequest
    openai-serialize.ts             Turn[] → OpenAI JSON + SSE
    anthropic-parse.ts              Anthropic body → CanonicalRequest
    anthropic-serialize.ts          Turn[] → Anthropic JSON + SSE
  server.ts                         HTTP server + FakeLlmServer control/assertion surface
  index.ts                          Public barrel export
  __tests__/
    recorder.test.ts
    matcher.test.ts
    scenario.test.ts
    openai-protocol.test.ts
    anthropic-protocol.test.ts
    server.test.ts
```

Each file has exactly one responsibility. Parsers and serializers are split by protocol so neither grows large, and JSON/SSE for the same protocol live together because they share the same `Turn`-to-wire mapping.

### Data flow

```
HTTP POST /v1/chat/completions (OpenAI)
  │
  ├─ parseOpenAiRequest()  ─►  CanonicalRequest
  │                                │
  │                         recorder.record()  ─►  RecordedRequest (index assigned)
  │                                │
  │                         selectResponse(scenario, recorded, index)
  │                                │
  │                    ┌──────────────────────┐
  │                    │  matched Turn[]        │  no match → sentinel text
  │                    └──────────────────────┘
  │                                │
  │              stream?  ─►  serializeOpenAiSse()
  │              else     ─►  serializeOpenAiResponse()
  │
  └─ HTTP response (JSON or text/event-stream)

HTTP POST /v1/messages (Anthropic) — same flow via anthropic-parse / anthropic-serialize
```

---

## Canonical types (`types.ts`)

All protocol-specific data is normalised into a single `CanonicalRequest` shape before it reaches the matcher. This means rules work identically regardless of whether the real API called OpenAI or Anthropic.

```typescript
type Protocol = "openai" | "anthropic";

interface CanonicalMessage {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
  toolName?: string; // populated for tool-result messages
}

interface CanonicalRequest {
  protocol: Protocol;
  model: string;
  system: string; // flattened system prompt text ('' when none)
  messages: CanonicalMessage[];
  tools: CanonicalToolDef[];
  stream: boolean;
  rawBody: unknown; // original parsed JSON for debugging
  headers: Record<string, string>;
}
```

Responses are described as `Turn[]`:

```typescript
type Turn = TextTurn | ToolCallTurn;

interface TextTurn {
  kind: "text";
  text: string;
}
interface ToolCallTurn {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
}
```

A `RecordedRequest` extends `CanonicalRequest` with a zero-based `index` field assigned at record time.

---

## Request recorder (`recorder.ts`)

The recorder keeps an ordered in-memory log of every request the server handles during a test. It is exposed as `server.requests` on the `FakeLlmServer` interface.

```typescript
interface RequestRecorder {
  record(request: CanonicalRequest): RecordedRequest;
  all(): RecordedRequest[];
  forProtocol(protocol: Protocol): RecordedRequest[];
  lastFor(protocol: Protocol): RecordedRequest | undefined;
  count(): number;
  reset(): void;
}
```

### Typical assertion patterns

```typescript
// Assert the first request used the lookup tool
expect(server.requests.all()[0].tools.map((t) => t.name)).toContain("lookup");

// Assert the last Anthropic call carried the expected system prompt
expect(server.requests.lastFor("anthropic")?.system).toContain(
  "You are a QA reviewer",
);

// Assert exactly two requests were made
expect(server.requests.count()).toBe(2);

// Inspect all OpenAI requests (e.g. to check turn count in multi-step agent)
const openaiReqs = server.requests.forProtocol("openai");
expect(openaiReqs).toHaveLength(3);
```

`reset()` clears the log and restarts index assignment from zero. Call it between test cases if the server is shared across a suite.

---

## Matcher engine (`matcher.ts`)

### Rule matching

A `Rule` has two parts: a `match` predicate object and a `respond` turn array. The matcher checks each predicate in `match` against the normalised request; all supplied predicates must hold for the rule to fire.

```typescript
interface RuleMatch {
  model?: string | RegExp; // exact string or regex against request.model
  systemIncludes?: string; // request.system must contain this substring
  userIncludes?: string; // last user message must contain this substring
  hasTool?: string; // tool with this name must be present in request.tools
  toolResultFor?: string; // a tool-result message for this tool must exist
  callIndex?: number; // zero-based index among all calls since reset()
}
```

An empty `match: {}` matches every request — use it as a catch-all.

### Response selection

`selectResponse(scenario, request, callIndex)` walks `scenario.rules` in declaration order and returns the `respond` array of the first matching rule, or `null` if nothing matches.

```typescript
import { matchesRule, selectResponse } from "./matcher.js";

const turns = selectResponse(scenario, canonicalRequest, 0);
// null  → no rule matched (server records this as an unmatched request)
// Turn[] → these turns are serialized back to the protocol format
```

---

## Scenario builder (`scenario.ts`)

### Turn factories

```typescript
import { text, toolCall } from "@nexus/e2e-tests/fake-llm";

text("The answer is 42");
// → TextTurn { kind: "text", text: "The answer is 42" }

toolCall("submit_qa_decision", { decision: "approve", rationale: "LGTM" });
// → ToolCallTurn { kind: "tool_call", toolName: "submit_qa_decision", arguments: { ... } }
```

### Type guards

```typescript
import { isText, isToolCall } from "@nexus/e2e-tests/fake-llm";

for (const turn of turns) {
  if (isText(turn)) console.log(turn.text);
  if (isToolCall(turn)) console.log(turn.toolName, turn.arguments);
}
```

### `scenario()` builder API

`scenario(name: string): ScenarioBuilder` returns a fluent builder. Rules are evaluated in the order they are declared — place more specific rules before general ones.

| Method      | Signature                             | Description                                     |
| ----------- | ------------------------------------- | ----------------------------------------------- |
| `when`      | `(match: RuleMatch): RuleBuilder`     | Add a rule with an explicit match predicate     |
| `whenTool`  | `(name: string): RuleBuilder`         | Shorthand for `when({ hasTool: name })`         |
| `otherwise` | `(...turns: Turn[]): ScenarioBuilder` | Add a catch-all rule (`match: {}`)              |
| `build`     | `(): Scenario`                        | Finalise and return the plain `Scenario` object |

`RuleBuilder.reply(...turns: Turn[]): ScenarioBuilder` — attaches the response turns and returns the builder for chaining.

A `ScenarioBuilder` can be passed directly to `loadScenario` — the server calls `toScenario()` internally, so `build()` is optional.

### Example — multi-rule scenario

```typescript
import { scenario, text, toolCall } from "@nexus/e2e-tests/fake-llm";

const qaScenario = scenario("qa-review")
  // Call 0: the model is given the lookup tool — call it
  .whenTool("lookup")
  .reply(toolCall("lookup", { query: "open PRs" }))

  // Call 1: the tool result comes back — submit the QA decision
  .when({ toolResultFor: "lookup" })
  .reply(
    toolCall("submit_qa_decision", {
      decision: "approve",
      rationale: "All clear",
    }),
  )

  // Catch-all for any unexpected call
  .otherwise(text("I don't know what to do"));
```

### Example — index-based rules (multi-turn agent)

```typescript
const multiTurnScenario = scenario("multi-turn")
  .when({ callIndex: 0 })
  .reply(text("First response"))
  .when({ callIndex: 1 })
  .reply(toolCall("finish", { result: "done" }))
  .otherwise(text("fallback"));
```

### Example — model and system discrimination

```typescript
scenario("routing")
  .when({ model: /claude/, systemIncludes: "summarize" })
  .reply(text("Here is the summary."))
  .when({ model: "gpt-4o", userIncludes: "translate" })
  .reply(text("Voici la traduction."))
  .otherwise(text("ok"));
```

---

## HTTP server (`server.ts`)

### Endpoints

| Method | Path                   | Description                                      |
| ------ | ---------------------- | ------------------------------------------------ |
| `GET`  | `/v1/models`           | Returns a minimal model list (OpenAI-compatible) |
| `POST` | `/v1/chat/completions` | OpenAI chat completions endpoint (JSON + SSE)    |
| `POST` | `/v1/messages`         | Anthropic Messages endpoint (JSON + SSE)         |

All other paths return `404 { error: "not found" }`.

### `FakeLlmServer` interface

```typescript
interface FakeLlmServer {
  port: number;
  url: string; // "http://127.0.0.1:<port>"
  requests: RequestRecorder;
  loadScenario(scenario: Scenario | ScenarioBuilder): void;
  unmatched(): RecordedRequest[];
  reset(): void;
  close(): Promise<void>;
}
```

| Member           | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `port`           | Ephemeral port the server bound to (`0.0.0.0:<port>`)                    |
| `url`            | Base URL to configure as the provider endpoint                           |
| `requests`       | Live `RequestRecorder` — query at any point during the test              |
| `loadScenario()` | Swap the active scenario at any point (takes effect on the next request) |
| `unmatched()`    | Returns a snapshot of all requests that matched no rule                  |
| `reset()`        | Clears `requests`, `unmatched`, and the internal seed counter            |
| `close()`        | Shuts down the HTTP server                                               |

### Unmatched requests

When no rule matches, the server:

1. Appends the `RecordedRequest` to the unmatched list.
2. Returns a text response containing the sentinel string `"__FAKE_LLM_NO_MATCHING_RULE__"` so the agent immediately receives something (rather than hanging) while the test can still detect the gap.

```typescript
expect(server.unmatched()).toHaveLength(0); // assert no rule gaps
```

---

## Using the fake LLM server in tests

### Setup pattern

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeLlmServer,
  scenario,
  text,
  toolCall,
  type FakeLlmServer,
} from "../../fake-llm/index.js";

let server: FakeLlmServer;

beforeEach(async () => {
  server = await createFakeLlmServer();
});

afterEach(async () => {
  await server.close();
});
```

`createFakeLlmServer()` binds to `0.0.0.0:0` (OS-assigned ephemeral port). Use `server.url` or `server.port` to configure the API under test.

### Loading a scenario

```typescript
server.loadScenario(
  scenario("my-test")
    .whenTool("get_file")
    .reply(toolCall("get_file", { path: "/src/main.ts" }))
    .otherwise(text("done")),
);
```

`loadScenario` accepts either a `ScenarioBuilder` (before `.build()`) or a plain `Scenario` object.

### Resetting between test cases

If you share a server instance across multiple test cases in a suite, call `server.reset()` between cases to clear recorded requests and unmatched state:

```typescript
afterEach(() => {
  server.reset();
});
```

### Asserting requests

```typescript
it("sends the system prompt", async () => {
  server.loadScenario(scenario("s").otherwise(text("ok")));

  // ... trigger the workflow that calls the LLM ...

  const last = server.requests.lastFor("openai");
  expect(last?.system).toContain("You are an expert code reviewer");
  expect(last?.tools.map((t) => t.name)).toContain("submit_review");
  expect(server.unmatched()).toHaveLength(0);
});
```

### Asserting SSE streaming

```typescript
it("streams the response", async () => {
  server.loadScenario(scenario("s").otherwise(text("streaming content")));

  const res = await fetch(`${server.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-test",
      stream: true,
      messages: [{ role: "user", content: "go" }],
    }),
  });

  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain('"content":"streaming content"');
  expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
});
```

---

## Protocol support

### OpenAI (`/v1/chat/completions`)

**Parser (`openai-parse.ts`)** — Accepts the standard OpenAI chat completions request body:

- `messages[].role` — `"system"`, `"user"`, `"assistant"`, `"tool"`.
- Multi-part content arrays are flattened to a string.
- `assistant` messages with `tool_calls` are recorded in the canonical messages list.
- `tool` messages have their `tool_call_id` resolved to the originating tool name using the assistant message that produced the call.
- `tools[].function.{name, description}` → `CanonicalToolDef`.
- `stream: true` sets `CanonicalRequest.stream`.

**Serializer — JSON (`serializeOpenAiResponse`)** — Returns an `OpenAiCompletion` object:

- Text turns → `choices[0].message.content` (string), `finish_reason: "stop"`.
- Tool call turns → `choices[0].message.tool_calls`, `finish_reason: "tool_calls"`.
- Multiple tool calls in one `Turn[]` are all included in `tool_calls`.

**Serializer — SSE (`serializeOpenAiSse`)** — Returns a `text/event-stream` body:

- Text: emits a single content delta chunk followed by a `finish_reason: "stop"` stop chunk and `data: [DONE]`.
- Tool calls: emits a name-announce delta, an arguments delta, and then a `finish_reason: "tool_calls"` stop chunk, followed by `data: [DONE]`.

### Anthropic (`/v1/messages`)

**Parser (`anthropic-parse.ts`)** — Accepts the Anthropic Messages API request body:

- `system` — accepts both a plain string and a content block array (`[{ type: "text", text: "..." }]`).
- `messages[].content` — accepts strings and block arrays.
- `tool_use` blocks in assistant content are indexed so that subsequent `tool_result` blocks can be resolved to their originating tool name.
- `tools[].{name, description}` → `CanonicalToolDef`.

**Serializer — JSON (`serializeAnthropicResponse`)** — Returns an `AnthropicMessageResponse` object:

- Text turns → `content: [{ type: "text", text }]`, `stop_reason: "end_turn"`.
- Tool call turns → `content: [{ type: "tool_use", id, name, input }]`, `stop_reason: "tool_use"`.

**Serializer — SSE (`serializeAnthropicSse`)** — Emits the full Anthropic event sequence:

```
event: message_start       (with message shell)
event: content_block_start (one per content block)
event: content_block_delta (text_delta or input_json_delta)
event: content_block_stop
event: message_delta       (stop_reason, usage)
event: message_stop
```

Each event is framed as `event: <name>\ndata: <json>\n\n`.

---

## Complete worked example

This example demonstrates a two-turn agent interaction where the model first calls a tool and then provides a text response after receiving the tool result.

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeLlmServer,
  scenario,
  text,
  toolCall,
  type FakeLlmServer,
} from "../../fake-llm/index.js";

describe("two-turn agent interaction", () => {
  let server: FakeLlmServer;

  beforeEach(async () => {
    server = await createFakeLlmServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("executes lookup then submits a decision", async () => {
    server.loadScenario(
      scenario("two-turn")
        // Turn 0: model sees lookup tool — call it
        .whenTool("lookup")
        .reply(toolCall("lookup", { query: "recent changes" }))
        // Turn 1: lookup result is back — submit the QA decision
        .when({ toolResultFor: "lookup" })
        .reply(toolCall("submit_qa_decision", { decision: "approve" }))
        // Safety catch-all
        .otherwise(text("unexpected state")),
    );

    // Point the API at the fake server
    process.env.OPENAI_BASE_URL = server.url;

    // ... trigger the code under test ...
    await runMyWorkflow();

    // Verify no unmatched requests
    expect(server.unmatched()).toHaveLength(0);

    // Verify exactly two LLM calls were made
    expect(server.requests.count()).toBe(2);

    // Verify the first call carried the lookup tool
    expect(server.requests.all()[0].tools.map((t) => t.name)).toContain(
      "lookup",
    );

    // Verify the second call carried the tool result
    const secondReq = server.requests.all()[1];
    const toolMsg = secondReq.messages.find((m) => m.role === "tool");
    expect(toolMsg?.toolName).toBe("lookup");
  });
});
```

---

## Running the tests

The fake-llm module tests are fast unit tests with no live infrastructure dependencies. Run them with:

```bash
# All fake-llm tests
npm run test --workspace=packages/e2e-tests -- src/fake-llm

# Single suite during development
npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/server.test.ts
```

The full suite covers recorder (3 tests), matcher (8 tests), scenario builder (3 tests), OpenAI protocol (5 tests), Anthropic protocol (4 tests), and server integration (6 tests).

---

## Relation to other subsystems

This is **subsystem 1 of 3** in the deterministic E2E harness initiative.

| Subsystem           | Description                                                                                                                                                                                                                   | Status                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1 — Fake LLM server | In-process scripted LLM, dual protocol, recording                                                                                                                                                                             | Complete (this document) |
| 2 — Stack harness   | Testcontainers `StackHarness`: pg, redis, API, Kanban, Docker network; provider seeding pointing at fake LLM via `host.docker.internal`; networking spike proves runner→fake-LLM connectivity ([doc 45](45-stack-harness.md)) | Complete                 |
| 3 — Scenario suites | Full workflow scenario suites (execution → review → Kanban lifecycle → repair paths); pruning stale E2E tests; rewiring `npm run test:e2e` and CI                                                                             | Planned                  |

The legacy `apps/api/test/helpers/fake-llm-server.ts` remains in place until subsystem 2 is complete, because the API tool-array harness still imports it. Subsystem 2 will repoint or delete it.

---

## Public API reference

All exports are re-exported from `packages/e2e-tests/src/fake-llm/index.ts`.

### Functions

| Export                | Signature                                                     | Description                            |
| --------------------- | ------------------------------------------------------------- | -------------------------------------- |
| `createFakeLlmServer` | `(): Promise<FakeLlmServer>`                                  | Starts the server on an ephemeral port |
| `scenario`            | `(name: string): ScenarioBuilder`                             | Creates a new scenario builder         |
| `text`                | `(value: string): TextTurn`                                   | Creates a text turn                    |
| `toolCall`            | `(name: string, args: Record<string, unknown>): ToolCallTurn` | Creates a tool call turn               |
| `isText`              | `(turn: Turn): turn is TextTurn`                              | Type guard for text turns              |
| `isToolCall`          | `(turn: Turn): turn is ToolCallTurn`                          | Type guard for tool call turns         |

### Constants

| Export               | Value                             | Description                                 |
| -------------------- | --------------------------------- | ------------------------------------------- |
| `UNMATCHED_SENTINEL` | `"__FAKE_LLM_NO_MATCHING_RULE__"` | Sentinel text returned when no rule matches |

### Types

`CanonicalRequest`, `CanonicalMessage`, `Protocol`, `RecordedRequest`, `Rule`, `RuleMatch`, `Scenario`, `TextTurn`, `ToolCallTurn`, `Turn`, `RequestRecorder`, `FakeLlmServer`
