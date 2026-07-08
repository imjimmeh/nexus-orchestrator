import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig, HarnessSessionRef } from "@nexus/core";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

// Capture the options the engine passes to the SDK `query` call.
const queryCalls: Array<{
  prompt: string | AsyncIterable<string>;
  options?: Record<string, unknown>;
}> = [];

// Default: a single result message so the session settles immediately.
let sdkMessages: unknown[] = [
  {
    type: "result",
    subtype: "success",
    result: "done",
    session_id: "s-produced",
  },
];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: {
    prompt: string | AsyncIterable<string>;
    options?: Record<string, unknown>;
  }) => {
    queryCalls.push(opts);
    return (async function* () {
      for (const m of sdkMessages) yield m;
    })();
  },
  createSdkMcpServer: () => ({ name: "mock" }),
  tool: (name: string) => ({ name }),
}));

// Import after the mock is registered.
const { ClaudeCodeEngine } = await import("../claude-code-engine.js");

function buildCtx(): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: async () => ({ status: "allowed" }),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath: "/ext",
    sessionPath: "/session.jsonl",
    contributions: EMPTY_HARNESS_CONTRIBUTIONS,
  };
}

function buildConfig(resume?: HarnessSessionRef): HarnessRuntimeConfig {
  return {
    harnessId: "claude-code",
    model: {
      provider: "anthropic",
      model: "claude-opus-4-8",
      auth: { type: "api_key", apiKey: "sk-test" },
    },
    prompt: { systemPrompt: "sys", initialPrompt: "hello" },
    ...(resume ? { session: { resume } } : {}),
  };
}

describe("ClaudeCodeEngine session resume", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    sdkMessages = [
      {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "s-produced",
      },
    ];
  });

  it("passes options.resume when a claude_code resume ref is present", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(
      buildConfig({ kind: "claude_code", sessionId: "s1" }),
      buildCtx(),
    );

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options?.resume).toBe("s1");
  });

  it("leaves options.resume undefined for a fresh session", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx());

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.options?.resume).toBeUndefined();
  });

  it("ignores a non-claude_code (pi) resume ref", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(
      buildConfig({ kind: "pi", treeId: "tree-1" }),
      buildCtx(),
    );

    expect(queryCalls[0]?.options?.resume).toBeUndefined();
  });

  it("allows a resumed session to accept a follow-up prompt()", async () => {
    const engine = new ClaudeCodeEngine();
    const session = await engine.createSession(
      buildConfig({ kind: "claude_code", sessionId: "s1" }),
      buildCtx(),
    );

    await expect(session.prompt("follow up")).resolves.toBeUndefined();
  });

  it("treats prompt() as a no-op for a fresh session (turn already started at createSession)", async () => {
    // The runtime server calls prompt(kickoffPrompt) once per step for every
    // engine. For claude-code the turn is already driven by query() at
    // createSession, so prompt() must resolve (no-op) — rejecting would abort
    // the in-flight turn before any event is forwarded. See kanban-miiu.
    const engine = new ClaudeCodeEngine();
    const session = await engine.createSession(buildConfig(), buildCtx());

    await expect(session.prompt("follow up")).resolves.toBeUndefined();
  });

  it("surfaces the produced sessionId from the init message", async () => {
    sdkMessages = [
      { type: "system", subtype: "init", session_id: "s-produced" },
      {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "s-produced",
      },
    ];
    const engine = new ClaudeCodeEngine();
    const session = await engine.createSession(buildConfig(), buildCtx());

    // Allow the async consume() loop to drain the mocked generator.
    await new Promise((r) => setTimeout(r, 0));

    expect(session.getProducedSessionId()).toBe("s-produced");
  });
});
