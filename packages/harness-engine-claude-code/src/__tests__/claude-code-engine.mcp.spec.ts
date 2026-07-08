import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig } from "@nexus/core";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

// Captures the options the engine passes to the SDK `query` call.
const queryCalls: Array<{
  prompt: string | AsyncIterable<string>;
  options?: Record<string, unknown>;
}> = [];

// Mirror the real `createSdkMcpServer` return shape: a COMPLETE server config
// `{ type, name, instance }` where only `instance` is the McpServer that owns
// `.connect`. The SDK extracts `entry.instance` exactly once and calls
// `instance.connect(transport)`, so the engine must hand this object to
// `mcpServers` verbatim — re-wrapping it makes the SDK call `.connect` on the
// wrapper, which throws "t.connect is not a function" (kanban-u4la).
const mcpServerInstance = { connect: () => Promise.resolve() };
const createdMcpServer = {
  type: "sdk",
  name: "nexus-kernel-tools",
  instance: mcpServerInstance,
};

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: {
    prompt: string | AsyncIterable<string>;
    options?: Record<string, unknown>;
  }) => {
    queryCalls.push(opts);
    return (async function* () {
      yield { type: "result", subtype: "success", result: "done" };
    })();
  },
  createSdkMcpServer: () => createdMcpServer,
  tool: (name: string) => ({ name }),
}));

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

function buildConfig(): HarnessRuntimeConfig {
  return {
    harnessId: "claude-code",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      auth: { type: "api_key", apiKey: "sk-test" },
    },
    prompt: { systemPrompt: "sys", initialPrompt: "hello" },
  };
}

describe("ClaudeCodeEngine SDK MCP server wiring (kanban-u4la)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("passes the createSdkMcpServer result to mcpServers verbatim (no double-wrap)", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx());

    expect(queryCalls).toHaveLength(1);
    const servers = queryCalls[0]?.options?.mcpServers as Record<
      string,
      unknown
    >;
    expect(servers["nexus-kernel-tools"]).toBe(createdMcpServer);
  });

  it("keeps instance pointing at the McpServer that owns connect() (regression guard)", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx());

    const entry = (
      queryCalls[0]?.options?.mcpServers as Record<
        string,
        { instance?: unknown }
      >
    )["nexus-kernel-tools"];
    // The SDK does `t = entry.instance; t.connect(transport)`. If the engine
    // re-wraps the config, entry.instance becomes the wrapper (no connect).
    expect(entry?.instance).toBe(mcpServerInstance);
    expect(typeof (entry?.instance as { connect?: unknown })?.connect).toBe(
      "function",
    );
  });
});
