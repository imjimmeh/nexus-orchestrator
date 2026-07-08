/**
 * Claude Code engine conformance test.
 *
 * Mocking strategy
 * ----------------
 * The vitest config aliases @anthropic-ai/claude-agent-sdk to our local stub
 * (test/conformance/__mocks__/claude-agent-sdk.ts). This ensures that the CC
 * engine's dynamic `import("@anthropic-ai/claude-agent-sdk")` in its compiled
 * dist/claude-code-engine.js resolves to the stub regardless of node_modules
 * resolution order.
 *
 * The stub exports a `setQueryImpl` helper that per-test code calls to control
 * which async generator sequence `query()` returns.
 *
 * Cases covered: C1–C7
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setQueryImpl,
  getLastQueryOptions,
} from "./__mocks__/claude-agent-sdk.js";
import type { SdkMessage } from "./fixtures/claude-code.js";
import {
  makeFullSessionGenerator,
  makeDenySessionGenerator,
  makeMinimalSessionGenerator,
} from "./fixtures/claude-code.js";
import { ClaudeCodeEngine } from "@nexus/harness-engine-claude-code";
import {
  makeMockContext,
  makeClaudeCodeConfig,
  makeClaudeCodeConfigWithAuth,
  API_KEY_AUTH_FIXTURE,
  OAUTH_AUTH_FIXTURE,
  collectEvents,
} from "./conformance-suite.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEngine(): ClaudeCodeEngine {
  return new ClaudeCodeEngine();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Claude Code Engine Conformance Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQueryImpl(
      makeMinimalSessionGenerator as () => AsyncIterable<SdkMessage>,
    );
  });

  // C1
  it("C1 — validate() returns ok:true for valid config", () => {
    const engine = createEngine();
    const result = engine.validate(makeClaudeCodeConfig());
    expect(result.ok).toBe(true);
  });

  // C2
  it("C2 — createSession() returns a HarnessSession with required methods", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);

    expect(typeof session.subscribe).toBe("function");
    expect(typeof session.prompt).toBe("function");
    expect(typeof session.abort).toBe("function");
    expect(typeof session.dispose).toBe("function");

    await session.dispose();
  });

  // C3
  it("C3 — session emits turn_start event", async () => {
    setQueryImpl(makeFullSessionGenerator as () => AsyncIterable<SdkMessage>);
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);
    const events = await collectEvents(session);

    expect(events.some((e) => e.type === "turn_start")).toBe(true);
  });

  // C4
  it("C4 — tool_execution_start event includes toolCallId, toolName, args", async () => {
    setQueryImpl(makeFullSessionGenerator as () => AsyncIterable<SdkMessage>);
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);
    const events = await collectEvents(session);

    const startEvent = events.find((e) => e.type === "tool_execution_start");
    expect(startEvent).toBeDefined();
    if (startEvent?.type === "tool_execution_start") {
      expect(typeof startEvent.toolCallId).toBe("string");
      expect(typeof startEvent.toolName).toBe("string");
      expect(typeof startEvent.args).toBe("object");
    }
  });

  // C5
  it("C5 — tool_execution_end event includes toolCallId, isError", async () => {
    setQueryImpl(makeFullSessionGenerator as () => AsyncIterable<SdkMessage>);
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);
    const events = await collectEvents(session);

    const endEvent = events.find((e) => e.type === "tool_execution_end");
    expect(endEvent).toBeDefined();
    if (endEvent?.type === "tool_execution_end") {
      expect(typeof endEvent.toolCallId).toBe("string");
      expect(typeof endEvent.isError).toBe("boolean");
    }
  });

  // C6
  it("C6 — agent_end event includes output.ok, output.response, output.stopReason", async () => {
    setQueryImpl(makeFullSessionGenerator as () => AsyncIterable<SdkMessage>);
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);
    const events = await collectEvents(session);

    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
    if (agentEnd?.type === "agent_end") {
      expect(typeof agentEnd.output.ok).toBe("boolean");
      expect(typeof agentEnd.output.response).toBe("string");
      expect(typeof agentEnd.output.stopReason).toBe("string");
    }
  });

  // C7
  it("C7 — governance deny results in no tool_execution_start", async () => {
    // The deny generator simulates what happens when the canUseTool callback
    // causes the SDK to not invoke the tool: no assistant message with tool_use
    // is yielded, so no tool_execution_start event is produced.
    setQueryImpl(makeDenySessionGenerator as () => AsyncIterable<SdkMessage>);
    const engine = createEngine();
    const ctx = makeMockContext({
      checkPermission: vi.fn(() =>
        Promise.resolve({
          status: "denied" as const,
          reason: "Not permitted by policy",
        }),
      ),
    });
    const session = await engine.createSession(makeClaudeCodeConfig(), ctx);
    const events = await collectEvents(session);

    const toolStart = events.find((e) => e.type === "tool_execution_start");
    expect(toolStart).toBeUndefined();
  });

  // C8
  it("C8 — api_key auth maps to ANTHROPIC_API_KEY in options.env", async () => {
    setQueryImpl(makeMinimalSessionGenerator as never);
    const engine = createEngine();
    const ctx = makeMockContext();
    await engine.createSession(
      makeClaudeCodeConfigWithAuth(API_KEY_AUTH_FIXTURE),
      ctx,
    );

    const options = getLastQueryOptions();
    expect(options?.env?.ANTHROPIC_API_KEY).toBe("conformance-api-key");
  });

  // C9
  it("C9 — oauth auth maps to CLAUDE_CODE_OAUTH_TOKEN in options.env", async () => {
    setQueryImpl(makeMinimalSessionGenerator as never);
    const engine = createEngine();
    const ctx = makeMockContext();
    await engine.createSession(
      makeClaudeCodeConfigWithAuth(OAUTH_AUTH_FIXTURE),
      ctx,
    );

    const options = getLastQueryOptions();
    expect(options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("access-abc");
  });
});
