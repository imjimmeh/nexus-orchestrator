# Fake LLM Server Implementation Plan (Subsystem 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, in-process **fake LLM server** that speaks both the OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) wire protocols (JSON + SSE), returns scripted responses chosen by matcher rules, and records every request so tests can assert exactly what prompts/system/tools the model received.

**Architecture:** A small set of focused modules under `packages/e2e-tests/src/fake-llm/`. Per-protocol **parsers** normalise incoming requests into one `CanonicalRequest` shape; a shared **matcher** picks the first matching `Rule` from the active `Scenario`; per-protocol **serializers** render the chosen protocol-agnostic `Turn[]` back into the correct wire format. An HTTP **server** ties them together and exposes a programmatic control/assertion surface (`loadScenario`, `reset`, `requests`, `unmatched`).

**Tech Stack:** Node `http`, TypeScript (strict, NodeNext ESM — relative imports use `.js`), Vitest. No new dependencies.

**Scope note:** This is subsystem 1 of 3. It is purely **additive** (new files only — it does not delete the stale suite or touch `apps/api`). Subsystem 2 (testcontainers `StackHarness`) and subsystem 3 (scenario suites) get their own plans and will repoint/delete the old `fake-llm-server.ts` and stale tests at that point. The modules built here run as fast, ungated unit tests under `npm test --workspace=packages/e2e-tests`.

---

## File Structure

```
packages/e2e-tests/src/fake-llm/
  types.ts                       # CanonicalRequest, Turn, Rule, Scenario, RecordedRequest
  recorder.ts                    # in-memory request log + query helpers
  matcher.ts                     # matchesRule() + selectResponse()
  scenario.ts                    # scenario() builder + text()/toolCall() + type guards
  protocols/openai-parse.ts      # OpenAI body -> CanonicalRequest
  protocols/openai-serialize.ts  # Turn[] -> OpenAI JSON + SSE
  protocols/anthropic-parse.ts   # Anthropic body -> CanonicalRequest
  protocols/anthropic-serialize.ts # Turn[] -> Anthropic JSON + SSE
  server.ts                      # http server + control/assertion surface
  index.ts                       # public barrel export
  __tests__/recorder.test.ts
  __tests__/matcher.test.ts
  __tests__/scenario.test.ts
  __tests__/openai-protocol.test.ts
  __tests__/anthropic-protocol.test.ts
  __tests__/server.test.ts
```

Each file has one responsibility. Parsers and serializers are split by protocol so neither file grows large, and JSON/SSE for one protocol live together because they share the same `Turn`→wire mapping.

---

## Task 1: Canonical types

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/types.ts`

- [ ] **Step 1: Write the type module** (no test — these are exercised by every later task's tests)

```typescript
// packages/e2e-tests/src/fake-llm/types.ts
export type Protocol = "openai" | "anthropic";

export type CanonicalRole = "system" | "user" | "assistant" | "tool";

export interface CanonicalToolDef {
  name: string;
  description: string;
}

export interface CanonicalMessage {
  role: CanonicalRole;
  text: string;
  /** For tool-result messages: the tool whose output this message carries. */
  toolName?: string;
}

export interface CanonicalRequest {
  protocol: Protocol;
  model: string;
  /** Flattened system prompt text ('' when none). */
  system: string;
  messages: CanonicalMessage[];
  tools: CanonicalToolDef[];
  stream: boolean;
  rawBody: unknown;
  headers: Record<string, string>;
}

export interface TextTurn {
  kind: "text";
  text: string;
}

export interface ToolCallTurn {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
}

export type Turn = TextTurn | ToolCallTurn;

export interface RuleMatch {
  model?: string | RegExp;
  systemIncludes?: string;
  /** Matched against the last user message's text. */
  userIncludes?: string;
  /** A tool with this name is present in the request's tool list. */
  hasTool?: string;
  /** The request carries a tool-result produced by this tool. */
  toolResultFor?: string;
  /** Zero-based index of this request among all requests since reset(). */
  callIndex?: number;
}

export interface Rule {
  match: RuleMatch;
  respond: Turn[];
}

export interface Scenario {
  name: string;
  rules: Rule[];
}

export interface RecordedRequest extends CanonicalRequest {
  index: number;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/types.ts
git commit -m "feat(e2e): canonical types for fake LLM server"
```

---

## Task 2: Request recorder

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/recorder.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/e2e-tests/src/fake-llm/__tests__/recorder.test.ts
import { describe, expect, it } from "vitest";
import { createRequestRecorder } from "../recorder.js";
import type { CanonicalRequest } from "../types.js";

function req(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    protocol: "openai",
    model: "m",
    system: "",
    messages: [],
    tools: [],
    stream: false,
    rawBody: {},
    headers: {},
    ...overrides,
  };
}

describe("createRequestRecorder", () => {
  it("assigns a monotonic index and returns the recorded request", () => {
    const recorder = createRequestRecorder();
    const first = recorder.record(req());
    const second = recorder.record(req());
    expect(first.index).toBe(0);
    expect(second.index).toBe(1);
    expect(recorder.count()).toBe(2);
  });

  it("filters by protocol and returns the last for a protocol", () => {
    const recorder = createRequestRecorder();
    recorder.record(req({ protocol: "openai", model: "a" }));
    recorder.record(req({ protocol: "anthropic", model: "b" }));
    recorder.record(req({ protocol: "anthropic", model: "c" }));
    expect(recorder.forProtocol("anthropic").map((r) => r.model)).toEqual([
      "b",
      "c",
    ]);
    expect(recorder.lastFor("anthropic")?.model).toBe("c");
    expect(recorder.lastFor("openai")?.model).toBe("a");
  });

  it("reset() clears the log and restarts indexing", () => {
    const recorder = createRequestRecorder();
    recorder.record(req());
    recorder.reset();
    expect(recorder.count()).toBe(0);
    expect(recorder.record(req()).index).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/recorder.test.ts`
Expected: FAIL — cannot find module `../recorder.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/e2e-tests/src/fake-llm/recorder.ts
import type { CanonicalRequest, Protocol, RecordedRequest } from "./types.js";

export interface RequestRecorder {
  record(request: CanonicalRequest): RecordedRequest;
  all(): RecordedRequest[];
  forProtocol(protocol: Protocol): RecordedRequest[];
  lastFor(protocol: Protocol): RecordedRequest | undefined;
  count(): number;
  reset(): void;
}

export function createRequestRecorder(): RequestRecorder {
  let requests: RecordedRequest[] = [];
  return {
    record(request) {
      const recorded: RecordedRequest = { ...request, index: requests.length };
      requests.push(recorded);
      return recorded;
    },
    all() {
      return [...requests];
    },
    forProtocol(protocol) {
      return requests.filter((entry) => entry.protocol === protocol);
    },
    lastFor(protocol) {
      const filtered = requests.filter((entry) => entry.protocol === protocol);
      return filtered[filtered.length - 1];
    },
    count() {
      return requests.length;
    },
    reset() {
      requests = [];
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/recorder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/recorder.ts packages/e2e-tests/src/fake-llm/__tests__/recorder.test.ts
git commit -m "feat(e2e): request recorder for fake LLM server"
```

---

## Task 3: Matcher engine

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/matcher.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/e2e-tests/src/fake-llm/__tests__/matcher.test.ts
import { describe, expect, it } from "vitest";
import { matchesRule, selectResponse } from "../matcher.js";
import type { CanonicalRequest, Scenario } from "../types.js";

function req(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    protocol: "openai",
    model: "gpt-test",
    system: "You are a helpful assistant.",
    messages: [{ role: "user", text: "please summarize" }],
    tools: [{ name: "submit_qa_decision", description: "" }],
    stream: false,
    rawBody: {},
    headers: {},
    ...overrides,
  };
}

describe("matchesRule", () => {
  it("returns true when every provided predicate holds", () => {
    expect(
      matchesRule(
        {
          model: /gpt/,
          systemIncludes: "helpful",
          userIncludes: "summarize",
          hasTool: "submit_qa_decision",
        },
        req(),
        0,
      ),
    ).toBe(true);
  });

  it("returns false when any predicate fails", () => {
    expect(matchesRule({ userIncludes: "translate" }, req(), 0)).toBe(false);
    expect(matchesRule({ model: "other" }, req(), 0)).toBe(false);
    expect(matchesRule({ hasTool: "missing_tool" }, req(), 0)).toBe(false);
  });

  it("matches callIndex against the supplied index", () => {
    expect(matchesRule({ callIndex: 2 }, req(), 2)).toBe(true);
    expect(matchesRule({ callIndex: 2 }, req(), 1)).toBe(false);
  });

  it("matches toolResultFor against tool-result messages", () => {
    const withResult = req({
      messages: [
        { role: "tool", text: '{"ok":true}', toolName: "submit_qa_decision" },
      ],
    });
    expect(
      matchesRule({ toolResultFor: "submit_qa_decision" }, withResult, 0),
    ).toBe(true);
    expect(matchesRule({ toolResultFor: "other" }, withResult, 0)).toBe(false);
  });

  it("an empty match object matches anything", () => {
    expect(matchesRule({}, req(), 5)).toBe(true);
  });
});

describe("selectResponse", () => {
  const scenario: Scenario = {
    name: "s",
    rules: [
      {
        match: { userIncludes: "translate" },
        respond: [{ kind: "text", text: "translation" }],
      },
      {
        match: { hasTool: "submit_qa_decision" },
        respond: [
          {
            kind: "tool_call",
            toolName: "submit_qa_decision",
            arguments: { decision: "approve" },
          },
        ],
      },
      { match: {}, respond: [{ kind: "text", text: "fallback" }] },
    ],
  };

  it("returns the first matching rule response", () => {
    expect(selectResponse(scenario, req(), 0)).toEqual([
      {
        kind: "tool_call",
        toolName: "submit_qa_decision",
        arguments: { decision: "approve" },
      },
    ]);
  });

  it("falls through to the catch-all rule", () => {
    expect(selectResponse(scenario, req({ tools: [] }), 0)).toEqual([
      { kind: "text", text: "fallback" },
    ]);
  });

  it("returns null when no rule matches", () => {
    expect(selectResponse({ name: "s", rules: [] }, req(), 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/matcher.test.ts`
Expected: FAIL — cannot find module `../matcher.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/e2e-tests/src/fake-llm/matcher.ts
import type { CanonicalRequest, RuleMatch, Scenario, Turn } from "./types.js";

export function matchesRule(
  match: RuleMatch,
  request: CanonicalRequest,
  callIndex: number,
): boolean {
  if (match.model !== undefined) {
    const matchesModel =
      match.model instanceof RegExp
        ? match.model.test(request.model)
        : request.model === match.model;
    if (!matchesModel) return false;
  }
  if (
    match.systemIncludes !== undefined &&
    !request.system.includes(match.systemIncludes)
  ) {
    return false;
  }
  if (match.userIncludes !== undefined) {
    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUser || !lastUser.text.includes(match.userIncludes)) return false;
  }
  if (
    match.hasTool !== undefined &&
    !request.tools.some((tool) => tool.name === match.hasTool)
  ) {
    return false;
  }
  if (
    match.toolResultFor !== undefined &&
    !request.messages.some(
      (message) =>
        message.role === "tool" && message.toolName === match.toolResultFor,
    )
  ) {
    return false;
  }
  if (match.callIndex !== undefined && match.callIndex !== callIndex) {
    return false;
  }
  return true;
}

export function selectResponse(
  scenario: Scenario,
  request: CanonicalRequest,
  callIndex: number,
): Turn[] | null {
  for (const rule of scenario.rules) {
    if (matchesRule(rule.match, request, callIndex)) {
      return rule.respond;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/matcher.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/matcher.ts packages/e2e-tests/src/fake-llm/__tests__/matcher.test.ts
git commit -m "feat(e2e): matcher engine for fake LLM scenarios"
```

---

## Task 4: Scenario builder + turn factories + type guards

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/scenario.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/scenario.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/e2e-tests/src/fake-llm/__tests__/scenario.test.ts
import { describe, expect, it } from "vitest";
import { isText, isToolCall, scenario, text, toolCall } from "../scenario.js";

describe("turn factories + guards", () => {
  it("builds typed turns and narrows them", () => {
    const t = text("hi");
    const c = toolCall("do_thing", { a: 1 });
    expect(isText(t)).toBe(true);
    expect(isToolCall(c)).toBe(true);
    expect(isText(c)).toBe(false);
    expect(c).toEqual({
      kind: "tool_call",
      toolName: "do_thing",
      arguments: { a: 1 },
    });
  });
});

describe("scenario builder", () => {
  it("records rules in declaration order with otherwise last", () => {
    const built = scenario("qa")
      .whenTool("submit_qa_decision")
      .reply(toolCall("submit_qa_decision", { decision: "approve" }))
      .when({ userIncludes: "retry" })
      .reply(text("retrying"))
      .otherwise(text("done"))
      .build();

    expect(built.name).toBe("qa");
    expect(built.rules).toHaveLength(3);
    expect(built.rules[0].match).toEqual({ hasTool: "submit_qa_decision" });
    expect(built.rules[1].match).toEqual({ userIncludes: "retry" });
    expect(built.rules[2].match).toEqual({});
    expect(built.rules[0].respond).toEqual([
      {
        kind: "tool_call",
        toolName: "submit_qa_decision",
        arguments: { decision: "approve" },
      },
    ]);
  });

  it("supports multiple turns in a single reply", () => {
    const built = scenario("multi")
      .when({})
      .reply(text("a"), text("b"))
      .build();
    expect(built.rules[0].respond).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/scenario.test.ts`
Expected: FAIL — cannot find module `../scenario.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/e2e-tests/src/fake-llm/scenario.ts
import type {
  Rule,
  RuleMatch,
  Scenario,
  TextTurn,
  ToolCallTurn,
  Turn,
} from "./types.js";

export function text(value: string): TextTurn {
  return { kind: "text", text: value };
}

export function toolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCallTurn {
  return { kind: "tool_call", toolName: name, arguments: args };
}

export function isText(turn: Turn): turn is TextTurn {
  return turn.kind === "text";
}

export function isToolCall(turn: Turn): turn is ToolCallTurn {
  return turn.kind === "tool_call";
}

export interface RuleBuilder {
  reply(...turns: Turn[]): ScenarioBuilder;
}

export class ScenarioBuilder {
  private readonly rules: Rule[] = [];

  constructor(private readonly scenarioName: string) {}

  when(match: RuleMatch): RuleBuilder {
    return {
      reply: (...turns: Turn[]): ScenarioBuilder => {
        this.rules.push({ match, respond: turns });
        return this;
      },
    };
  }

  whenTool(name: string): RuleBuilder {
    return this.when({ hasTool: name });
  }

  otherwise(...turns: Turn[]): ScenarioBuilder {
    this.rules.push({ match: {}, respond: turns });
    return this;
  }

  build(): Scenario {
    return { name: this.scenarioName, rules: [...this.rules] };
  }
}

export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name);
}

export function toScenario(value: Scenario | ScenarioBuilder): Scenario {
  return value instanceof ScenarioBuilder ? value.build() : value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/scenario.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/scenario.ts packages/e2e-tests/src/fake-llm/__tests__/scenario.test.ts
git commit -m "feat(e2e): scenario builder and turn factories"
```

---

## Task 5: OpenAI protocol (parse + serialize)

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/protocols/openai-parse.ts`
- Create: `packages/e2e-tests/src/fake-llm/protocols/openai-serialize.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/openai-protocol.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/openai-protocol.test.ts`
Expected: FAIL — cannot find module `../protocols/openai-parse.js`.

- [ ] **Step 3a: Write the parser**

```typescript
// packages/e2e-tests/src/fake-llm/protocols/openai-parse.ts
import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRole,
  CanonicalToolDef,
} from "../types.js";

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiTool {
  function?: { name?: string; description?: string };
}

interface OpenAiBody {
  model?: string;
  messages?: OpenAiMessage[];
  tools?: OpenAiTool[];
  stream?: boolean;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function normaliseRole(role: string | undefined): CanonicalRole {
  if (role === "system" || role === "assistant" || role === "tool") return role;
  return "user";
}

export function parseOpenAiRequest(
  body: unknown,
  headers: Record<string, string>,
): CanonicalRequest {
  const parsed = (body ?? {}) as OpenAiBody;
  const rawMessages = parsed.messages ?? [];

  const toolNameById = new Map<string, string>();
  for (const message of rawMessages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.function?.name) {
        toolNameById.set(call.id, call.function.name);
      }
    }
  }

  const messages: CanonicalMessage[] = rawMessages.map((message) => {
    const role = normaliseRole(message.role);
    if (role === "tool") {
      return {
        role: "tool",
        text: flattenContent(message.content),
        toolName: message.tool_call_id
          ? toolNameById.get(message.tool_call_id)
          : undefined,
      };
    }
    return { role, text: flattenContent(message.content) };
  });

  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join("\n");

  const tools: CanonicalToolDef[] = (parsed.tools ?? []).map((tool) => ({
    name: tool.function?.name ?? "",
    description: tool.function?.description ?? "",
  }));

  return {
    protocol: "openai",
    model: parsed.model ?? "",
    system,
    messages,
    tools,
    stream: parsed.stream === true,
    rawBody: body,
    headers,
  };
}
```

- [ ] **Step 3b: Write the serializer**

```typescript
// packages/e2e-tests/src/fake-llm/protocols/openai-serialize.ts
import { isText, isToolCall } from "../scenario.js";
import type { Turn } from "../types.js";

const CREATED = 1_700_000_000;

interface OpenAiToolCallOut {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessageOut {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAiToolCallOut[];
}

export interface OpenAiCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAiMessageOut;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function completionId(seed: number): string {
  return `chatcmpl-${String(seed).padStart(8, "0")}`;
}

function toToolCalls(turns: Turn[]): OpenAiToolCallOut[] {
  return turns.filter(isToolCall).map((turn, index) => ({
    id: `call_${String(index).padStart(4, "0")}`,
    type: "function",
    function: {
      name: turn.toolName,
      arguments: JSON.stringify(turn.arguments),
    },
  }));
}

export function serializeOpenAiResponse(
  turns: Turn[],
  model: string,
  seed: number,
): OpenAiCompletion {
  const toolCalls = toToolCalls(turns);
  const textTurn = turns.find(isText);

  if (toolCalls.length > 0) {
    return {
      id: completionId(seed),
      object: "chat.completion",
      created: CREATED,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null, tool_calls: toolCalls },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
  }

  return {
    id: completionId(seed),
    object: "chat.completion",
    created: CREATED,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: textTurn ? textTurn.text : "" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

export function serializeOpenAiSse(
  turns: Turn[],
  model: string,
  seed: number,
): string {
  const id = completionId(seed);
  const toolCalls = toToolCalls(turns);
  const textTurn = turns.find(isText);
  const lines: string[] = [];
  const push = (payload: unknown): void => {
    lines.push(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const base = { id, object: "chat.completion.chunk", created: CREATED, model };

  if (toolCalls.length === 0 && textTurn) {
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: textTurn.text },
          finish_reason: null,
        },
      ],
    });
  }

  toolCalls.forEach((call, index) => {
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: call.id,
                type: "function",
                function: { name: call.function.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index, function: { arguments: call.function.arguments } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  });

  push({
    ...base,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
  });
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/openai-protocol.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/protocols/openai-parse.ts packages/e2e-tests/src/fake-llm/protocols/openai-serialize.ts packages/e2e-tests/src/fake-llm/__tests__/openai-protocol.test.ts
git commit -m "feat(e2e): OpenAI protocol parse + serialize for fake LLM"
```

---

## Task 6: Anthropic protocol (parse + serialize)

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/protocols/anthropic-parse.ts`
- Create: `packages/e2e-tests/src/fake-llm/protocols/anthropic-serialize.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/anthropic-protocol.test.ts`

Background — Anthropic Messages API shapes the serializer must produce:

- **JSON:** `{ id, type:'message', role:'assistant', model, content: [{type:'text',text}] | [{type:'tool_use',id,name,input}], stop_reason: 'end_turn' | 'tool_use', stop_sequence: null, usage }`.
- **SSE event order:** `message_start` → (`content_block_start` → `content_block_delta`\* → `content_block_stop`)+ → `message_delta` → `message_stop`. Text blocks use `text_delta`; tool_use blocks use `input_json_delta` with `partial_json`. Each event is framed as `event: <name>\ndata: <json>\n\n`.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/anthropic-protocol.test.ts`
Expected: FAIL — cannot find module `../protocols/anthropic-parse.js`.

- [ ] **Step 3a: Write the parser**

```typescript
// packages/e2e-tests/src/fake-llm/protocols/anthropic-parse.ts
import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRole,
  CanonicalToolDef,
} from "../types.js";

interface AnthropicBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicMessage {
  role?: string;
  content?: unknown;
}

interface AnthropicTool {
  name?: string;
  description?: string;
}

interface AnthropicBody {
  model?: string;
  system?: unknown;
  messages?: AnthropicMessage[];
  tools?: AnthropicTool[];
  stream?: boolean;
}

function flattenSystem(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}

function toBlocks(content: unknown): AnthropicBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as AnthropicBlock[];
  return [];
}

function flattenResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

function normaliseRole(role: string | undefined): CanonicalRole {
  return role === "assistant" ? "assistant" : "user";
}

export function parseAnthropicRequest(
  body: unknown,
  headers: Record<string, string>,
): CanonicalRequest {
  const parsed = (body ?? {}) as AnthropicBody;
  const rawMessages = parsed.messages ?? [];

  const toolNameById = new Map<string, string>();
  for (const message of rawMessages) {
    for (const block of toBlocks(message.content)) {
      if (block.type === "tool_use" && block.id && block.name) {
        toolNameById.set(block.id, block.name);
      }
    }
  }

  const messages: CanonicalMessage[] = [];
  for (const message of rawMessages) {
    const role = normaliseRole(message.role);
    for (const block of toBlocks(message.content)) {
      if (block.type === "text") {
        messages.push({ role, text: block.text ?? "" });
      } else if (block.type === "tool_use") {
        messages.push({ role: "assistant", text: "", toolName: block.name });
      } else if (block.type === "tool_result") {
        messages.push({
          role: "tool",
          text: flattenResultContent(block.content),
          toolName: block.tool_use_id
            ? toolNameById.get(block.tool_use_id)
            : undefined,
        });
      }
    }
  }

  const tools: CanonicalToolDef[] = (parsed.tools ?? []).map((tool) => ({
    name: tool.name ?? "",
    description: tool.description ?? "",
  }));

  return {
    protocol: "anthropic",
    model: parsed.model ?? "",
    system: flattenSystem(parsed.system),
    messages,
    tools,
    stream: parsed.stream === true,
    rawBody: body,
    headers,
  };
}
```

- [ ] **Step 3b: Write the serializer**

```typescript
// packages/e2e-tests/src/fake-llm/protocols/anthropic-serialize.ts
import { isToolCall } from "../scenario.js";
import type { Turn } from "../types.js";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use";
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

function messageId(seed: number): string {
  return `msg_${String(seed).padStart(8, "0")}`;
}

function toContentBlocks(turns: Turn[]): AnthropicContentBlock[] {
  return turns.map((turn, index) =>
    turn.kind === "tool_call"
      ? {
          type: "tool_use",
          id: `toolu_${String(index).padStart(4, "0")}`,
          name: turn.toolName,
          input: turn.arguments,
        }
      : { type: "text", text: turn.text },
  );
}

export function serializeAnthropicResponse(
  turns: Turn[],
  model: string,
  seed: number,
): AnthropicMessageResponse {
  const content = toContentBlocks(turns);
  return {
    id: messageId(seed),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: turns.some(isToolCall) ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

export function serializeAnthropicSse(
  turns: Turn[],
  model: string,
  seed: number,
): string {
  const id = messageId(seed);
  const content = toContentBlocks(turns);
  const stopReason: "end_turn" | "tool_use" = turns.some(isToolCall)
    ? "tool_use"
    : "end_turn";
  const events: string[] = [];
  const emit = (event: string, data: unknown): void => {
    events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  emit("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });

  content.forEach((block, index) => {
    if (block.type === "text") {
      emit("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      emit("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      emit("content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {},
        },
      });
      emit("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input),
        },
      });
    }
    emit("content_block_stop", { type: "content_block_stop", index });
  });

  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  events.push(
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  );
  return events.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/anthropic-protocol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/protocols/anthropic-parse.ts packages/e2e-tests/src/fake-llm/protocols/anthropic-serialize.ts packages/e2e-tests/src/fake-llm/__tests__/anthropic-protocol.test.ts
git commit -m "feat(e2e): Anthropic protocol parse + serialize for fake LLM"
```

---

## Task 7: HTTP server + control/assertion surface

**Files:**

- Create: `packages/e2e-tests/src/fake-llm/server.ts`
- Create: `packages/e2e-tests/src/fake-llm/index.ts`
- Test: `packages/e2e-tests/src/fake-llm/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/server.test.ts`
Expected: FAIL — cannot find module `../server.js`.

- [ ] **Step 3a: Write the server**

```typescript
// packages/e2e-tests/src/fake-llm/server.ts
import * as http from "node:http";
import { selectResponse } from "./matcher.js";
import { parseAnthropicRequest } from "./protocols/anthropic-parse.js";
import {
  serializeAnthropicResponse,
  serializeAnthropicSse,
} from "./protocols/anthropic-serialize.js";
import { parseOpenAiRequest } from "./protocols/openai-parse.js";
import {
  serializeOpenAiResponse,
  serializeOpenAiSse,
} from "./protocols/openai-serialize.js";
import { createRequestRecorder, type RequestRecorder } from "./recorder.js";
import { ScenarioBuilder, text, toScenario } from "./scenario.js";
import type {
  CanonicalRequest,
  RecordedRequest,
  Scenario,
  Turn,
} from "./types.js";

export const UNMATCHED_SENTINEL = "__FAKE_LLM_NO_MATCHING_RULE__";

export interface FakeLlmServer {
  port: number;
  url: string;
  requests: RequestRecorder;
  loadScenario(scenario: Scenario | ScenarioBuilder): void;
  unmatched(): RecordedRequest[];
  reset(): void;
  close(): Promise<void>;
}

interface ServerState {
  scenario: Scenario;
  recorder: RequestRecorder;
  unmatched: RecordedRequest[];
  seed: number;
}

function collectHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        resolve(raw);
      }
    });
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendSse(res: http.ServerResponse, payload: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.end(payload);
}

function resolveTurns(state: ServerState, recorded: RecordedRequest): Turn[] {
  const turns = selectResponse(state.scenario, recorded, recorded.index);
  if (turns === null) {
    state.unmatched.push(recorded);
    return [text(UNMATCHED_SENTINEL)];
  }
  return turns;
}

function handleCompletion(
  state: ServerState,
  parsed: CanonicalRequest,
  res: http.ServerResponse,
): void {
  const recorded = state.recorder.record(parsed);
  const turns = resolveTurns(state, recorded);
  const seed = (state.seed += 1);

  if (parsed.protocol === "openai") {
    if (parsed.stream)
      sendSse(res, serializeOpenAiSse(turns, parsed.model, seed));
    else sendJson(res, 200, serializeOpenAiResponse(turns, parsed.model, seed));
    return;
  }
  if (parsed.stream)
    sendSse(res, serializeAnthropicSse(turns, parsed.model, seed));
  else
    sendJson(res, 200, serializeAnthropicResponse(turns, parsed.model, seed));
}

export function createFakeLlmServer(): Promise<FakeLlmServer> {
  const state: ServerState = {
    scenario: { name: "empty", rules: [] },
    recorder: createRequestRecorder(),
    unmatched: [],
    seed: 0,
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const headers = collectHeaders(req);
      if (req.method === "GET" && req.url === "/v1/models") {
        sendJson(res, 200, {
          object: "list",
          data: [{ id: "fake-model", object: "model", owned_by: "test" }],
        });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        handleCompletion(
          state,
          parseOpenAiRequest(await readBody(req), headers),
          res,
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/messages") {
        handleCompletion(
          state,
          parseAnthropicRequest(await readBody(req), headers),
          res,
        );
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to resolve fake LLM server address"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        requests: state.recorder,
        loadScenario(next) {
          state.scenario = toScenario(next);
        },
        unmatched() {
          return [...state.unmatched];
        },
        reset() {
          state.recorder.reset();
          state.unmatched = [];
          state.seed = 0;
        },
        close() {
          return new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          });
        },
      });
    });
  });
}
```

- [ ] **Step 3b: Write the barrel export**

```typescript
// packages/e2e-tests/src/fake-llm/index.ts
export {
  createFakeLlmServer,
  UNMATCHED_SENTINEL,
  type FakeLlmServer,
} from "./server.js";
export {
  scenario,
  text,
  toolCall,
  isText,
  isToolCall,
  ScenarioBuilder,
} from "./scenario.js";
export type {
  CanonicalRequest,
  CanonicalMessage,
  Protocol,
  RecordedRequest,
  Rule,
  RuleMatch,
  Scenario,
  TextTurn,
  ToolCallTurn,
  Turn,
} from "./types.js";
export type { RequestRecorder } from "./recorder.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm/__tests__/server.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e-tests/src/fake-llm/server.ts packages/e2e-tests/src/fake-llm/index.ts packages/e2e-tests/src/fake-llm/__tests__/server.test.ts
git commit -m "feat(e2e): fake LLM HTTP server with dual-protocol routing and control surface"
```

---

## Task 8: Full-module verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole fake-llm test group**

Run: `npm run test --workspace=packages/e2e-tests -- src/fake-llm`
Expected: PASS — all suites (recorder, matcher, scenario, openai-protocol, anthropic-protocol, server).

- [ ] **Step 2: Typecheck the workspace**

Run: `npm run typecheck --workspace=packages/e2e-tests`
Expected: PASS (no errors).

- [ ] **Step 3: Confirm nothing else in the package regressed**

Run: `npm run test --workspace=packages/e2e-tests`
Expected: PASS (existing deterministic tests + new fake-llm tests; gated e2e tests remain skipped because `RUN_E2E_TESTS` is unset).

- [ ] **Step 4: Commit (only if any fixups were needed; otherwise skip)**

```bash
git add -A packages/e2e-tests
git commit -m "test(e2e): verify fake LLM module suite green"
```

---

## Self-Review (performed during planning)

- **Spec coverage:** §4 of the design (fake LLM server — dual protocol, matcher rules, recording/assertions, TS authoring, fail-loud unmatched) is fully covered by Tasks 1–7. §2/§3 injection-path and §5/§6 stack + scenarios are explicitly **out of scope for this plan** (subsystems 2 and 3). The §4 "replaces existing fake-llm-server.ts" cleanup is deferred to subsystem 2/3 (noted in the scope note) because deleting it now would break the `apps/api` tool-array harness that still imports it.
- **Placeholder scan:** none — every code/test/command step is concrete.
- **Type consistency:** `Turn`/`TextTurn`/`ToolCallTurn`, `CanonicalRequest`, `Scenario`/`Rule`/`RuleMatch`, `RecordedRequest`, and the `RequestRecorder` method names (`record`/`all`/`forProtocol`/`lastFor`/`count`/`reset`) are defined in Tasks 1–2 and used identically in Tasks 3–7. `scenario()/whenTool()/when()/reply()/otherwise()/build()`, `text()/toolCall()/isText()/isToolCall()/toScenario()`, and serializer signatures `(turns, model, seed)` are consistent across all consuming tasks and the server.

## Next subsystems (separate plans, after this one is green)

1. **Stack harness (testcontainers):** `StackHarness` lifecycle (pg, redis, api, kanban, named network), provider seeding pointing at the in-process fake LLM via `host.docker.internal`, the networking spike, and repointing/deleting the legacy `apps/api/test/helpers/fake-llm-server.ts`.
2. **Scenario suites:** generic workflow execution → review/QA callback → kanban lifecycle → repair/failure paths, plus pruning the stale `packages/e2e-tests` suites and rewiring `npm run test:e2e` + the CI job.
