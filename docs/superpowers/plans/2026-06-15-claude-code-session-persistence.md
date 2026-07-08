# Claude Code Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the claude-code harness persist its session as a pi-compatible v3 JSONL tree so `pi_session_trees`, the retrieval skills, distillation, failure-evidence, and resume all work identically to the pi harness.

**Architecture:** The claude-code engine writes the pi-coding-agent SDK's native "v3" session JSONL to `ctx.sessionPath` (the same `CONTAINER_SESSION_PATH` pi uses). A new engine-agnostic `V3SessionWriter` (in `@nexus/harness-runtime`) owns the file/tree mechanics (session header, node ids, linear `parentId` chaining, resume continuation); a new claude-specific `ClaudeV3Mapper` translates Anthropic SDK messages into v3 node payloads. The existing `SessionHydrationService` extract→validate→secret-scan→gzip→`pi_session_trees` pipeline then works unchanged. We do **not** rename the `pi_session_trees` table; we do rename the pi-specific reap method to a harness-neutral name.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, NestJS (apps/api), npm workspaces. Build `packages/core` and `packages/harness-runtime` before dependents.

**Reference spec:** `docs/superpowers/specs/2026-06-15-claude-code-session-persistence-design.md`

**The v3 format contract (confirmed from live data, `pi_session_trees.id = f669a97f-ca68-4b5a-befa-88ce82c59a66`):**

```jsonc
{ "type": "session", "version": 3, "id": "<id>", "timestamp": "<iso>", "cwd": "/workspace" }
{ "type": "model_change", "id": "<id>", "parentId": null, "timestamp": "<iso>", "provider": "anthropic", "modelId": "claude-sonnet-4-6" }
{ "type": "message", "id": "<id>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "user", "content": [ { "type": "text", "text": "..." } ] } }
{ "type": "message", "id": "<id>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "assistant",
    "content": [ { "type": "text", "text": "..." }, { "type": "toolCall", "id": "<callId>", "name": "<tool>", "arguments": {} } ],
    "provider": "anthropic", "model": "claude-sonnet-4-6",
    "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "stopReason": "toolUse", "responseId": "..." } }
{ "type": "message", "id": "<id>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "toolResult", "toolCallId": "<callId>", "toolName": "<tool>", "content": [ { "type": "text", "text": "..." } ] } }
```

Validation rules enforced downstream (`apps/api/src/session/jsonl-validation.service.ts`): every line needs a truthy `id` and `type`; `parentId` must reference an existing node id; no cycles; `last_leaf_node_id` = the last node's `id`.

---

## File Structure

**Create:**

- `packages/harness-runtime/src/session/v3-session-writer.types.ts` — v3 node/message/usage TypeScript types (the shared contract).
- `packages/harness-runtime/src/session/v3-session-writer.ts` — `V3SessionWriter` (header, append, ids, parentId chain, resume).
- `packages/harness-runtime/test/session/v3-session-writer.test.ts` — writer unit tests.
- `packages/harness-engine-claude-code/src/map-claude-message-to-v3.ts` — `ClaudeV3Mapper` (Anthropic SDK msg → v3 node payloads).
- `packages/harness-engine-claude-code/test/map-claude-message-to-v3.test.ts` — mapper unit tests.
- `packages/harness-conformance/test/conformance/claude-code-session-jsonl.test.ts` — golden v3 conformance test.
- `packages/harness-conformance/test/conformance/__fixtures__/claude-v3-golden.jsonl` — golden expected nodes (ids/timestamps normalized).

**Modify:**

- `packages/harness-runtime/src/index.ts` — export `V3SessionWriter` + types.
- `packages/harness-engine-claude-code/src/claude-code-session.ts` — accept an optional v3 sink; append per message in `consume()`.
- `packages/harness-engine-claude-code/src/claude-code-engine.ts` — construct writer + mapper, emit `model_change`, pass sink to the session.
- `apps/api/src/chat/chat-sessions/chat-sessions.mappers.ts` — add `harnessId` to `buildChatSessionCreatePayload`.
- `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` — generalize the `marker.engine === 'pi'` reap branch to also cover `claude-code`; rename `persistPiSessionFromHost`.
- `docs/guide/12-ai-config.md` (or session-hydration doc) — document claude-code session persistence parity.

---

## Task 1: `V3SessionWriter` + shared types (harness-runtime)

**Files:**

- Create: `packages/harness-runtime/src/session/v3-session-writer.types.ts`
- Create: `packages/harness-runtime/src/session/v3-session-writer.ts`
- Test: `packages/harness-runtime/test/session/v3-session-writer.test.ts`
- Modify: `packages/harness-runtime/src/index.ts`

- [ ] **Step 1: Write the types file**

Create `packages/harness-runtime/src/session/v3-session-writer.types.ts`:

```ts
/** v3 token-usage block as written in pi-coding-agent session JSONL. */
export interface V3Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface V3TextBlock {
  type: "text";
  text: string;
}

export interface V3ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type V3ContentBlock = V3TextBlock | V3ToolCallBlock;

export interface V3UserMessage {
  role: "user";
  content: V3ContentBlock[];
}

export interface V3AssistantMessage {
  role: "assistant";
  content: V3ContentBlock[];
  provider?: string;
  model?: string;
  usage?: V3Usage;
  stopReason?: string;
  responseId?: string;
}

export interface V3ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: V3TextBlock[];
}

export type V3Message =
  | V3UserMessage
  | V3AssistantMessage
  | V3ToolResultMessage;

/**
 * A node payload WITHOUT the writer-owned envelope fields (`id`, `parentId`,
 * `timestamp`). The writer assigns those on append.
 */
export type V3NodePayload =
  | { type: "model_change"; provider: string; modelId: string }
  | { type: "message"; message: V3Message };

export interface V3WriterOptions {
  /** Generates node/session ids. Inject a deterministic counter in tests. */
  genId: () => string;
  /** Returns an ISO timestamp string. Inject a fixed clock in tests. */
  now: () => string;
}
```

- [ ] **Step 2: Write the failing writer test**

Create `packages/harness-runtime/test/session/v3-session-writer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V3SessionWriter } from "../../src/session/v3-session-writer.js";

function deterministicOpts() {
  let n = 0;
  return { genId: () => `id${++n}`, now: () => "2026-06-15T00:00:00.000Z" };
}

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("V3SessionWriter", () => {
  let sessionPath: string;
  beforeEach(() => {
    sessionPath = join(mkdtempSync(join(tmpdir(), "v3-")), "session.jsonl");
  });

  it("create() writes a v3 session header", () => {
    V3SessionWriter.create(sessionPath, "/workspace", deterministicOpts());
    const [header] = readLines(sessionPath);
    expect(header).toMatchObject({
      type: "session",
      version: 3,
      id: "id1",
      cwd: "/workspace",
    });
  });

  it("appendNode() assigns id, links parentId to the previous node, and chains linearly", () => {
    const w = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    const firstId = w.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    const secondId = w.appendNode({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    });
    const lines = readLines(sessionPath);
    expect(firstId).toBe("id2");
    expect(secondId).toBe("id3");
    expect(lines[1]).toMatchObject({
      type: "model_change",
      id: "id2",
      parentId: null,
    });
    expect(lines[2]).toMatchObject({
      type: "message",
      id: "id3",
      parentId: "id2",
    });
    expect(lines[2].message).toMatchObject({ role: "user" });
  });

  it("every emitted node has a truthy id and type (downstream validation invariant)", () => {
    const w = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    w.appendNode({ type: "model_change", provider: "anthropic", modelId: "m" });
    for (const node of readLines(sessionPath)) {
      expect(node.id).toBeTruthy();
      expect(node.type).toBeTruthy();
    }
  });

  it("open() seeds the parent pointer from the last node so resume continues the chain", () => {
    const w1 = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    w1.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "m",
    }); // id2
    w1.appendNode({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "a" }] },
    }); // id3 (last)

    const resumeOpts = (() => {
      let n = 100;
      return { genId: () => `r${++n}`, now: () => "2026-06-15T01:00:00.000Z" };
    })();
    const w2 = V3SessionWriter.open(sessionPath, resumeOpts);
    w2.appendNode({
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "b" }] },
    }); // r101
    const lines = readLines(sessionPath);
    const appended = lines[lines.length - 1];
    expect(appended).toMatchObject({ id: "r101", parentId: "id3" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- v3-session-writer`
Expected: FAIL — cannot resolve `../../src/session/v3-session-writer.js`.

- [ ] **Step 4: Implement `V3SessionWriter`**

Create `packages/harness-runtime/src/session/v3-session-writer.ts`:

```ts
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type {
  V3NodePayload,
  V3WriterOptions,
} from "./v3-session-writer.types.js";

/**
 * Writes a pi-coding-agent "v3" session JSONL: a `session` header followed by
 * one node per line, each chained to the previous via `parentId`. Engine-agnostic
 * — callers supply already-shaped node payloads. The writer owns id/parentId/
 * timestamp assignment so the output matches what the pi SDK produces and passes
 * the API's JSONL/tree validation.
 */
export class V3SessionWriter {
  private parentId: string | null = null;

  private constructor(
    private readonly sessionPath: string,
    private readonly opts: V3WriterOptions,
  ) {}

  /** Starts a fresh session file with a v3 `session` header line. */
  static create(
    sessionPath: string,
    cwd: string,
    opts: V3WriterOptions,
  ): V3SessionWriter {
    const writer = new V3SessionWriter(sessionPath, opts);
    const header = {
      type: "session",
      version: 3,
      id: opts.genId(),
      timestamp: opts.now(),
      cwd,
    };
    writeFileSync(sessionPath, JSON.stringify(header) + "\n");
    return writer;
  }

  /** Re-opens an existing session file, continuing the chain from the last node. */
  static open(sessionPath: string, opts: V3WriterOptions): V3SessionWriter {
    const writer = new V3SessionWriter(sessionPath, opts);
    const lines = readFileSync(sessionPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    const last = lines.length
      ? (JSON.parse(lines[lines.length - 1]) as { id?: string })
      : undefined;
    writer.parentId = last?.id ?? null;
    return writer;
  }

  /** Appends one node, assigning id/parentId/timestamp. Returns the new node id. */
  appendNode(payload: V3NodePayload): string {
    const id = this.opts.genId();
    const node = {
      ...payload,
      id,
      parentId: this.parentId,
      timestamp: this.opts.now(),
    };
    appendFileSync(this.sessionPath, JSON.stringify(node) + "\n");
    this.parentId = id;
    return id;
  }
}
```

- [ ] **Step 5: Export from the package index**

In `packages/harness-runtime/src/index.ts`, add after the Checkpoint exports block (around line 94):

```ts
// Session (v3 JSONL writer)
export { V3SessionWriter } from "./session/v3-session-writer.js";
export type {
  V3NodePayload,
  V3Message,
  V3ContentBlock,
  V3Usage,
  V3WriterOptions,
} from "./session/v3-session-writer.types.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace=packages/harness-runtime -- v3-session-writer`
Expected: PASS (4 tests).

- [ ] **Step 7: Build the package**

Run: `npm run build --workspace=packages/harness-runtime`
Expected: clean build (dependents resolve `V3SessionWriter` from dist).

- [ ] **Step 8: Commit**

```bash
git add packages/harness-runtime/src/session packages/harness-runtime/test/session packages/harness-runtime/src/index.ts
git commit -m "feat(harness-runtime): add V3SessionWriter for pi-compatible session JSONL"
```

---

## Task 2: `ClaudeV3Mapper` — Anthropic SDK message → v3 node payloads

**Files:**

- Create: `packages/harness-engine-claude-code/src/map-claude-message-to-v3.ts`
- Test: `packages/harness-engine-claude-code/test/map-claude-message-to-v3.test.ts`

- [ ] **Step 1: Write the failing mapper test**

Create `packages/harness-engine-claude-code/test/map-claude-message-to-v3.test.ts`:

```ts
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
    // First the assistant tool_use so the mapper learns the tool name for call_1
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- map-claude-message-to-v3`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ClaudeV3Mapper`**

Create `packages/harness-engine-claude-code/src/map-claude-message-to-v3.ts`:

```ts
import type {
  V3NodePayload,
  V3ContentBlock,
  V3TextBlock,
  V3Usage,
} from "@nexus/harness-runtime";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}
type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string };

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface SdkAssistant {
  type: "assistant";
  message: {
    content: AnthropicBlock[];
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: AnthropicUsage;
  };
}
interface SdkUser {
  type: "user";
  message: { content: AnthropicBlock[] };
}
type SdkMessage = SdkAssistant | SdkUser | { type: string };

function toV3Usage(u: AnthropicUsage | undefined): V3Usage | undefined {
  if (!u) return undefined;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function stringifyToolResult(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Translates Anthropic Claude Agent SDK stream messages into pi-compatible v3
 * node payloads. Stateful only for the tool_use id -> tool name cache, mirroring
 * ClaudeEventMapper. Pure with respect to ids/timestamps (the writer owns those).
 */
export class ClaudeV3Mapper {
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly ctx: { provider: string; model: string }) {}

  map(msg: unknown): V3NodePayload[] {
    const message = msg as SdkMessage;

    if (message.type === "assistant") {
      const { message: m } = message as SdkAssistant;
      const content: V3ContentBlock[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          content.push({
            type: "text",
            text: (block as AnthropicTextBlock).text,
          });
        } else if (block.type === "thinking") {
          content.push({
            type: "text",
            text: `<think>\n${(block as AnthropicThinkingBlock).thinking}\n</think>`,
          });
        } else if (block.type === "tool_use") {
          const tu = block as AnthropicToolUseBlock;
          this.toolNames.set(tu.id, tu.name);
          content.push({
            type: "toolCall",
            id: tu.id,
            name: tu.name,
            arguments: tu.input,
          });
        }
      }
      return [
        {
          type: "message",
          message: {
            role: "assistant",
            content,
            provider: this.ctx.provider,
            model: m.model ?? this.ctx.model,
            usage: toV3Usage(m.usage),
            stopReason: m.stop_reason,
            responseId: m.id,
          },
        },
      ];
    }

    if (message.type === "user") {
      const { message: m } = message as SdkUser;
      const nodes: V3NodePayload[] = [];
      const textBlocks: V3TextBlock[] = [];
      for (const block of m.content) {
        if (block.type === "tool_result") {
          const tr = block as AnthropicToolResultBlock;
          nodes.push({
            type: "message",
            message: {
              role: "toolResult",
              toolCallId: tr.tool_use_id,
              toolName: this.toolNames.get(tr.tool_use_id) ?? "unknown",
              content: [
                { type: "text", text: stringifyToolResult(tr.content) },
              ],
            },
          });
        } else if (block.type === "text") {
          textBlocks.push({
            type: "text",
            text: (block as AnthropicTextBlock).text,
          });
        }
      }
      if (textBlocks.length) {
        nodes.push({
          type: "message",
          message: { role: "user", content: textBlocks },
        });
      }
      return nodes;
    }

    return [];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- map-claude-message-to-v3`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harness-engine-claude-code/src/map-claude-message-to-v3.ts packages/harness-engine-claude-code/test/map-claude-message-to-v3.test.ts
git commit -m "feat(claude-code): map Anthropic SDK messages to v3 session nodes"
```

---

## Task 3: Wire writer + mapper into the claude-code engine

**Files:**

- Modify: `packages/harness-engine-claude-code/src/claude-code-session.ts`
- Modify: `packages/harness-engine-claude-code/src/claude-code-engine.ts`
- Test: `packages/harness-engine-claude-code/test/claude-code-session.v3-sink.test.ts` (create)

- [ ] **Step 1: Confirm the model id field on `HarnessRuntimeConfig.model`**

Read the `HarnessRuntimeConfig` type (search): `Grep` for `model` in `packages/core/src/interfaces/harness*.ts`. Confirm whether the model identifier is `config.model.model`, `config.model.modelId`, or `config.model.name`. Use the confirmed property in Step 4 where this plan writes `MODEL_ID_FIELD`. (`config.model.provider` is already confirmed used in `claude-code-engine.ts:48`.)

- [ ] **Step 2: Write the failing session-sink test**

Create `packages/harness-engine-claude-code/test/claude-code-session.v3-sink.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeSession } from "../src/claude-code-session.js";
import { ClaudeEventMapper } from "../src/map-claude-event.js";
import { ClaudeV3Mapper } from "../src/map-claude-message-to-v3.js";

function scriptedGen(messages: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

describe("ClaudeCodeSession v3 sink", () => {
  it("appends a v3 node for each mapped SDK message via the injected sink", async () => {
    const appended: unknown[] = [];
    const sink = {
      appendNode: vi.fn((p: unknown) => {
        appended.push(p);
        return "id";
      }),
    };
    const v3mapper = new ClaudeV3Mapper({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });

    const gen = scriptedGen([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
      { type: "result", subtype: "success", result: "done" },
    ]);
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("step"),
      "step",
      {
        v3Sink: sink,
        v3Mapper: v3mapper,
      },
    );
    // Allow the async consume() loop to drain.
    await new Promise((r) => setTimeout(r, 10));
    await session.dispose();

    expect(sink.appendNode).toHaveBeenCalledTimes(1); // assistant -> 1 node; result -> 0
  });

  it("does not throw if the sink append fails (best-effort persistence)", async () => {
    const sink = {
      appendNode: vi.fn(() => {
        throw new Error("disk full");
      }),
    };
    const v3mapper = new ClaudeV3Mapper({ provider: "anthropic", model: "m" });
    const gen = scriptedGen([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "x" }] },
      },
    ]);
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("s"),
      "s",
      { v3Sink: sink, v3Mapper: v3mapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    // No assertion needed beyond "did not throw"; dispose cleanly.
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-session.v3-sink`
Expected: FAIL — `ClaudeCodeSessionOptions` has no `v3Sink`/`v3Mapper`.

- [ ] **Step 4: Extend `ClaudeCodeSession` to append to the sink**

In `packages/harness-engine-claude-code/src/claude-code-session.types.ts`, add the optional sink + mapper to `ClaudeCodeSessionOptions` (read the file first; add these fields):

```ts
import type { V3SessionWriter } from "@nexus/harness-runtime";
import type { ClaudeV3Mapper } from "./map-claude-message-to-v3.js";

// inside ClaudeCodeSessionOptions:
  /** Optional v3 JSONL sink; when present, each SDK message is persisted. */
  v3Sink?: Pick<V3SessionWriter, "appendNode">;
  v3Mapper?: ClaudeV3Mapper;
```

In `packages/harness-engine-claude-code/src/claude-code-session.ts`:

- Add private fields in the constructor body (after `this.resumable = ...`):

```ts
this.v3Sink = options.v3Sink;
this.v3Mapper = options.v3Mapper;
```

- Declare the fields near the other privates (after `private producedSessionId`):

```ts
  private readonly v3Sink?: Pick<import("@nexus/harness-runtime").V3SessionWriter, "appendNode">;
  private readonly v3Mapper?: import("./map-claude-message-to-v3.js").ClaudeV3Mapper;
```

- In `consume()`, after `this.captureSessionId(msg);` and before the canonical mapping loop, add best-effort v3 persistence:

```ts
this.persistV3(msg);
```

- Add the helper method:

```ts
  /** Best-effort: persist the SDK message as v3 node(s). Never throws. */
  private persistV3(msg: unknown): void {
    if (!this.v3Sink || !this.v3Mapper) return;
    try {
      for (const node of this.v3Mapper.map(msg)) {
        this.v3Sink.appendNode(node);
      }
    } catch {
      // Persistence is best-effort; a write failure must not abort the turn.
    }
  }
```

- [ ] **Step 5: Run the session test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-session.v3-sink`
Expected: PASS (2 tests).

- [ ] **Step 6: Construct the writer + mapper in the engine**

In `packages/harness-engine-claude-code/src/claude-code-engine.ts`:

- Add imports near the top:

```ts
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { V3SessionWriter } from "@nexus/harness-runtime";
import { ClaudeV3Mapper } from "./map-claude-message-to-v3.js";
```

- Inside `createSession`, after `const mapper = new ClaudeEventMapper(stepId);` (line 59), build the v3 sink. Use the model id field confirmed in Step 1 (shown here as `config.model.model`):

```ts
// v3 session persistence: write the pi-compatible session JSONL so the
// existing SessionHydrationService pipeline persists this run to
// pi_session_trees, exactly like the pi harness.
const v3Provider = config.model?.provider ?? "anthropic";
const v3Model = config.model?.model ?? "unknown";
const v3WriterOpts = {
  genId: () => randomUUID().slice(0, 8),
  now: () => new Date().toISOString(),
};
let v3Sink: V3SessionWriter | undefined;
try {
  if (existsSync(ctx.sessionPath)) {
    v3Sink = V3SessionWriter.open(ctx.sessionPath, v3WriterOpts);
  } else {
    v3Sink = V3SessionWriter.create(
      ctx.sessionPath,
      ctx.workspacePath,
      v3WriterOpts,
    );
    v3Sink.appendNode({
      type: "model_change",
      provider: v3Provider,
      modelId: v3Model,
    });
  }
} catch {
  v3Sink = undefined; // best-effort; never block session creation
}
const v3Mapper = new ClaudeV3Mapper({ provider: v3Provider, model: v3Model });
```

> Note: `new Date().toISOString()` and `randomUUID()` are intentional here (production runtime inside the container), not in deterministic test code.

- Pass the sink + mapper into BOTH `ClaudeCodeSession` constructions. Replace the SDK-path construction (lines 158-160):

```ts
sessionRef = new ClaudeCodeSession(gen, mapper, stepId, {
  resumable: resumeSessionId !== undefined,
  v3Sink,
  v3Mapper,
});
```

And the stub-path construction (line 172):

```ts
return new ClaudeCodeSession(stub, mapper, stepId, { v3Sink, v3Mapper });
```

- [ ] **Step 7: Build the package and run the engine test suite**

Run: `npm run build --workspace=packages/harness-engine-claude-code && npm run test --workspace=packages/harness-engine-claude-code`
Expected: build clean; all tests pass (existing + new).

- [ ] **Step 8: Commit**

```bash
git add packages/harness-engine-claude-code/src/claude-code-engine.ts packages/harness-engine-claude-code/src/claude-code-session.ts packages/harness-engine-claude-code/src/claude-code-session.types.ts packages/harness-engine-claude-code/test/claude-code-session.v3-sink.test.ts
git commit -m "feat(claude-code): persist v3 session JSONL during the run"
```

---

## Task 4: Golden conformance test

**Files:**

- Create: `packages/harness-conformance/test/conformance/claude-code-session-jsonl.test.ts`
- Create: `packages/harness-conformance/test/conformance/__fixtures__/claude-v3-golden.jsonl`

- [ ] **Step 1: Inspect the existing pi conformance test for structure/conventions**

Read `packages/harness-conformance/test/conformance/pi.conformance.test.ts` to match the package's test conventions (imports, how it instantiates engines, tsconfig/vitest setup).

- [ ] **Step 2: Write the golden fixture**

Create `packages/harness-conformance/test/conformance/__fixtures__/claude-v3-golden.jsonl` — the expected v3 nodes (with `id`/`parentId`/`timestamp` normalized to placeholders) for a fixed claude message sequence. One JSON object per line:

```jsonl
{"type":"session","version":3,"id":"<ID>","timestamp":"<TS>","cwd":"/workspace"}
{"type":"model_change","id":"<ID>","parentId":null,"timestamp":"<TS>","provider":"anthropic","modelId":"claude-sonnet-4-6"}
{"type":"message","id":"<ID>","parentId":"<PID>","timestamp":"<TS>","message":{"role":"assistant","content":[{"type":"text","text":"Calling a tool"},{"type":"toolCall","id":"call_1","name":"kanban_project_state","arguments":{"max":100}}],"provider":"anthropic","model":"claude-sonnet-4-6","usage":{"input":10,"output":5,"cacheRead":2,"cacheWrite":1,"totalTokens":15,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"tool_use","responseId":"resp_1"}}
{"type":"message","id":"<ID>","parentId":"<PID>","timestamp":"<TS>","message":{"role":"toolResult","toolCallId":"call_1","toolName":"kanban_project_state","content":[{"type":"text","text":"{\"ok\":true}"}]}}
```

- [ ] **Step 3: Write the conformance test**

Create `packages/harness-conformance/test/conformance/claude-code-session-jsonl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V3SessionWriter } from "@nexus/harness-runtime";
import { ClaudeV3Mapper } from "@nexus/harness-engine-claude-code/src/map-claude-message-to-v3.js";

// Deterministic id/timestamp generators so output is byte-stable.
function deterministicOpts() {
  let n = 0;
  return { genId: () => `node${++n}`, now: () => "2026-06-15T00:00:00.000Z" };
}

const CLAUDE_STREAM = [
  {
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
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: '{"ok":true}',
          is_error: false,
        },
      ],
    },
  },
  { type: "result", subtype: "success", result: "done" },
];

function normalize(node: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...node };
  if ("id" in clone) clone.id = "<ID>";
  if ("parentId" in clone)
    clone.parentId = clone.parentId === null ? null : "<PID>";
  if ("timestamp" in clone) clone.timestamp = "<TS>";
  return clone;
}

describe("claude-code session JSONL conformance", () => {
  it("produces v3 nodes that satisfy validation invariants and match the golden fixture", () => {
    const sessionPath = join(
      mkdtempSync(join(tmpdir(), "conf-")),
      "session.jsonl",
    );
    const writer = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    writer.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    const mapper = new ClaudeV3Mapper({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    for (const msg of CLAUDE_STREAM)
      for (const node of mapper.map(msg)) writer.appendNode(node);

    const produced = readFileSync(sessionPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // Invariant 1: every node has truthy id + type (jsonl-validation.service.ts).
    for (const node of produced) {
      expect(node.id).toBeTruthy();
      expect(node.type).toBeTruthy();
    }
    // Invariant 2: parentId references resolve (validateTreeStructure).
    const ids = new Set(produced.map((n) => n.id));
    for (const node of produced) {
      const parent = (node.parentId ?? null) as string | null;
      if (parent) expect(ids.has(parent)).toBe(true);
    }
    // Invariant 3: structural match against the golden fixture (ids/ts normalized).
    const golden = readFileSync(
      join(__dirname, "__fixtures__/claude-v3-golden.jsonl"),
      "utf-8",
    )
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(produced.map(normalize)).toEqual(golden.map(normalize));
  });
});
```

> If `@nexus/harness-engine-claude-code` does not expose a deep-import path, add a barrel export of `ClaudeV3Mapper` from its package index and import from the package root instead. Confirm the import style against how `pi.conformance.test.ts` imports the pi engine.

- [ ] **Step 4: Run the conformance test**

Run: `npm run test --workspace=packages/harness-conformance -- claude-code-session-jsonl`
Expected: PASS. If the structural match fails, reconcile the fixture with the real pi format in the spec (do not weaken invariants 1–2).

- [ ] **Step 5: Commit**

```bash
git add packages/harness-conformance/test/conformance/claude-code-session-jsonl.test.ts packages/harness-conformance/test/conformance/__fixtures__/claude-v3-golden.jsonl
git commit -m "test(harness-conformance): golden v3 session JSONL for claude-code"
```

---

## Task 5: Populate `chat_sessions.harness_id`

**Files:**

- Modify: `apps/api/src/chat/chat-sessions/chat-sessions.mappers.ts`
- Test: `apps/api/src/chat/chat-sessions/chat-sessions.mappers.spec.ts` (create or extend)

- [ ] **Step 1: Write the failing mapper test**

Create/extend `apps/api/src/chat/chat-sessions/chat-sessions.mappers.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ChatSessionSource,
  ChatSessionStatus,
  ChatSessionExecutionState,
} from "@nexus/core";
import { buildChatSessionCreatePayload } from "./chat-sessions.mappers";

describe("buildChatSessionCreatePayload harness_id", () => {
  const base = {
    profile: { id: "p1", name: "ceo-agent" },
    status: ChatSessionStatus.PENDING,
    executionState: "queued" as ChatSessionExecutionState,
    source: ChatSessionSource.AD_HOC,
    initialMessage: "hi",
  };

  it("sets harness_id when provided", () => {
    const payload = buildChatSessionCreatePayload({
      ...base,
      harnessId: "claude-code",
    });
    expect(payload.harness_id).toBe("claude-code");
  });

  it("defaults harness_id to null when omitted", () => {
    const payload = buildChatSessionCreatePayload(base);
    expect(payload.harness_id).toBeNull();
  });
});
```

> Confirm the exact `ChatSessionStatus`/`ChatSessionExecutionState` enum members against `@nexus/core` before running; adjust the literals if names differ.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- chat-sessions.mappers`
Expected: FAIL — `harnessId` not accepted / `harness_id` undefined.

- [ ] **Step 3: Add `harnessId` to the payload builder**

In `apps/api/src/chat/chat-sessions/chat-sessions.mappers.ts`, extend `buildChatSessionCreatePayload`:

- Add to the params type: `harnessId?: string | null;`
- Add to the returned object (before `...params.overrides`): `harness_id: params.harnessId ?? null,`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- chat-sessions.mappers`
Expected: PASS.

- [ ] **Step 5: Thread the resolved harness id into the create call**

Find the call site(s) of `buildChatSessionCreatePayload` (`Grep` in `apps/api/src/chat`). At each site that creates a session for execution, pass the harness id resolved for that dispatch. Locate where the chat execution resolves its harness (`Grep` for `resolveRunnerHarness` / `resolveHarnessId` / `scopedDefaults` in `apps/api/src/chat`). If the harness is resolved only later (in container-config building), pass the same resolver result, or set `harness_id` on the session row at dispatch time via the existing update path used for executions. Add/extend a unit test on that service asserting the created session carries `harness_id`.

> Keep this DRY: reuse the existing harness-resolution result (the executions table already persists `harness_id`); do not introduce a second resolution path.

- [ ] **Step 6: Run the API test suite for the touched areas**

Run: `npm run test --workspace=apps/api -- chat-sessions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/chat/chat-sessions/chat-sessions.mappers.ts apps/api/src/chat/chat-sessions/chat-sessions.mappers.spec.ts
git commit -m "feat(chat): persist harness_id on chat session creation"
```

---

## Task 6: Generalize the reap path to claude-code

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts` (extend)

- [ ] **Step 1: Read the current reap branch and method**

Read `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` around the `if (marker.engine === 'pi')` branch and the `persistPiSessionFromHost` method. Note: the method reads the host sidecar `session.jsonl` and calls `sessionHydration.saveSessionFromJsonl(...)`, returning `{ kind: 'pi', treeId }`.

- [ ] **Step 2: Write the failing reap test**

Extend `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts` with a case asserting that when `marker.engine === 'claude-code'` and a non-empty host session file exists, the supervisor persists the session and records a checkpoint with `sessionRef = { kind: 'claude_code', treeId }`. Mirror the existing pi reap test setup (mock `sessionHydration.saveSessionFromJsonl` to resolve a tree id; mock the host file read). Use the same mocking utilities already present in the spec.

```ts
// Sketch — adapt to the spec's existing harness/mocks:
it("persists a claude-code session from the host file on reap", async () => {
  // arrange: marker.engine = 'claude-code', host session file returns valid JSONL,
  //          sessionHydration.saveSessionFromJsonl resolves 'tree-123'
  // act: run the reap entrypoint used by the existing pi test
  // assert: checkpointRepo.record called with sessionRef { kind: 'claude_code', treeId: 'tree-123' }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution-supervisor`
Expected: FAIL — claude-code engine falls through; no session persisted.

- [ ] **Step 4: Generalize the branch and rename the method**

In `execution-supervisor.service.ts`:

- Replace the `if (marker.engine === 'pi') { sessionRef = await this.persistPiSessionFromHost(...) }` branch with one that runs for both engines:

```ts
if (marker.engine === "pi" || marker.engine === "claude-code") {
  const treeId = await this.persistHarnessSessionFromHost(
    workflowRunId,
    jobId,
    sessionHydration,
    row.container_tier ?? undefined,
  );
  sessionRef = treeId ? { kind: marker.engine, treeId } : null;
}
```

- Rename `persistPiSessionFromHost` to `persistHarnessSessionFromHost` and change its return type to `Promise<string | null>` (return the tree id or null; the caller wraps it with the engine kind). Update the internal `return { kind: 'pi', treeId }` to `return treeId;` and the early returns from `null` accordingly. Update log messages from "PI session" to "harness session".

> Confirm the `sessionRef` discriminated-union type accepts `kind: 'claude_code'` (it does per `packages/core/src/interfaces/agent-await.types.ts` `HarnessSessionRef`). If `kind` is narrowed to `'pi'` anywhere in this file's local types, widen it to the shared `HarnessSessionRef` union.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution-supervisor`
Expected: PASS (existing pi case still green; new claude-code case green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervisor.service.ts apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts
git commit -m "feat(execution-lifecycle): persist claude-code sessions on reap"
```

---

## Task 7: Lint, full build, and live integration verification

**Files:** none (verification only)

- [ ] **Step 1: Lint the touched workspaces**

Run: `npm run lint:api` and `npm run lint --workspace=packages/harness-runtime` and `npm run lint --workspace=packages/harness-engine-claude-code`
Expected: no errors. Fix any findings in code (no `eslint-disable` per project policy).

- [ ] **Step 2: Build everything in dependency order**

Run: `npm run build --workspace=packages/core && npm run build --workspace=packages/harness-runtime && npm run build --workspace=packages/harness-engine-claude-code && npm run build:api`
Expected: clean builds.

- [ ] **Step 3: Rebuild the harness container images (they bundle the engines)**

Run: `docker compose build` (rebuilds `nexus-light`/`nexus-heavy` with the updated engine code). Confirm the claude-code engine changes are included in the image.

- [ ] **Step 4: Trigger a claude-code run and verify persistence**

Set a scope's `scoped_ai_default` to claude-code (via the UI `Scopes → AI Defaults` tab, or insert a `scoped_ai_default` row) for a test scope, trigger a workflow run on it, then verify a session tree was persisted:

```bash
docker exec nexus-postgres psql -U nexus nexus_orchestrator -c "SELECT id, workflow_run_id, chat_session_id, container_tier, last_leaf_node_id, jsonb_array_length(jsonl_data) FROM pi_session_trees ORDER BY created_at DESC LIMIT 3;"
```

Expected: a row whose `workflow_run_id` matches the claude-code run, with a non-empty `last_leaf_node_id`.

- [ ] **Step 5: Decode the persisted JSONL and confirm v3 shape**

Use the `retrieve-session-logs` skill (or the decode snippet in `.agents/skills/retrieve-session-logs`) against the new `workflow_run_id`. Confirm the decoded JSONL starts with a `session` header, has a `model_change` with `provider:"anthropic"`, and contains `message` nodes with `role` `assistant`/`toolResult`. Confirm `retrieve-session-logs` produces a readable `.jsonl` (proves downstream parity).

- [ ] **Step 6: Restore the test scope default**

If you changed a real scope's `scoped_ai_default` for testing, restore/delete it so it inherits the intended platform default.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A && git commit -m "fix: address lint/build/integration findings for claude-code session persistence"
```

---

## Task 8: Documentation

**Files:**

- Modify: `docs/guide/12-ai-config.md` (and/or `docs/epics/epic-006-session-hydration/index.md`)

- [ ] **Step 1: Document the parity**

Add a short subsection noting that the claude-code harness now persists its session as a pi-compatible v3 JSONL tree (`V3SessionWriter` + `ClaudeV3Mapper`) to `pi_session_trees`, that `chat_sessions.harness_id` is populated at creation, and that the reap path covers both engines. State the non-goal: claude-code resume remains linear (no mid-session branching).

- [ ] **Step 2: Commit**

```bash
git add docs/guide/12-ai-config.md
git commit -m "docs: claude-code session persistence parity"
```

---

## Self-Review

**Spec coverage:**

- v3 writer (own serializer in harness-runtime) → Task 1. ✓
- Claude→v3 mapper (SDK messages, usage remap, tool_use→toolCall, tool_result→toolResult) → Task 2. ✓
- Wire into engine + best-effort/no-crash + resume continuation → Task 3. ✓
- Golden conformance (format-identical guarantee) → Task 4. ✓
- `chat_sessions.harness_id` populated → Task 5. ✓
- Reap generalized to claude-code + method rename (keep table name) → Task 6. ✓
- No mount/env changes (verified, nothing to do) → covered by Task 7 integration. ✓
- Downstream consumers unchanged → validated empirically in Task 7 Step 5. ✓

**Placeholder scan:** Two deliberate "confirm the exact field/enum" investigation steps (Task 3 Step 1 model id field; Task 5 enum members; Task 5 Step 5 call-site wiring) exist because those signatures live in files outside what this plan quotes verbatim — each names the exact file to read and the exact symbol to confirm, which is a real action, not a vague placeholder.

**Type consistency:** `V3NodePayload` / `V3SessionWriter` / `ClaudeV3Mapper` names are used identically across Tasks 1–4. `appendNode` signature `(payload: V3NodePayload) => string` is consistent. `persistHarnessSessionFromHost` (returns `string | null`) and `sessionRef = { kind: marker.engine, treeId }` are consistent in Task 6.
