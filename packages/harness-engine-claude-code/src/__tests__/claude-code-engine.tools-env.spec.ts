import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig } from "@nexus/core";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";
import type {
  HarnessSessionContext,
  CanonicalToolSpec,
} from "@nexus/harness-runtime";

// Captures the options the engine passes to the SDK `query` call.
const queryCalls: Array<{
  prompt: string | AsyncIterable<string>;
  options?: Record<string, unknown>;
}> = [];

// Captures the tool definitions registered into the SDK MCP server.
const registeredTools: string[] = [];
const registeredSchemas: unknown[] = [];

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
  tool: (name: string, _description: string, schema: unknown) => {
    registeredTools.push(name);
    registeredSchemas.push(schema);
    return { name };
  },
}));

const { ClaudeCodeEngine } = await import("../claude-code-engine.js");

function makeSpec(name: string): CanonicalToolSpec {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object" },
    invoke: async () => ({ content: [] }),
  };
}

function buildCtx(
  over: Partial<HarnessSessionContext> = {},
): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: async () => ({ status: "allowed" }),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath: "/ext",
    sessionPath: "/session.jsonl",
    contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    ...over,
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

describe("ClaudeCodeEngine tool catalog registration", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    registeredTools.length = 0;
    registeredSchemas.length = 0;
  });

  it("registers every toolCatalog entry as an SDK tool", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(
      buildConfig(),
      buildCtx({
        toolCatalog: [
          makeSpec("set_job_output"),
          makeSpec("query_memory"),
          makeSpec("read_skill_manifest"),
        ],
      }),
    );

    expect(registeredTools).toEqual([
      "set_job_output",
      "query_memory",
      "read_skill_manifest",
    ]);
  });

  it("hands the SDK a Zod schema, not a raw JSON Schema (SDK rejects the latter)", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(
      buildConfig(),
      buildCtx({ toolCatalog: [makeSpec("set_job_output")] }),
    );

    const schema = registeredSchemas[0] as {
      parse?: unknown;
      safeParse?: unknown;
    };
    expect(typeof schema?.parse).toBe("function");
    expect(typeof schema?.safeParse).toBe("function");
  });
});

describe("ClaudeCodeEngine subprocess environment", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    registeredTools.length = 0;
  });

  it("merges process.env into the SDK env so PATH survives", async () => {
    process.env["NEXUS_ENV_MERGE_PROBE"] = "present";
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx());

    const env = queryCalls[0]?.options?.env as Record<string, string>;
    // The SDK REPLACES (not merges) the subprocess environment, so PATH must be
    // carried over explicitly or the agent's Bash tool loses ls/head/cat.
    expect(env["PATH"]).toBe(process.env["PATH"]);
    expect(env["NEXUS_ENV_MERGE_PROBE"]).toBe("present");
    delete process.env["NEXUS_ENV_MERGE_PROBE"];
  });

  it("still delivers the auth credential alongside the inherited env", async () => {
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx());

    const env = queryCalls[0]?.options?.env as Record<string, string>;
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-test");
  });
});

describe("ClaudeCodeEngine governance tool-name normalization", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    registeredTools.length = 0;
  });

  it("strips the nexus MCP prefix before consulting checkPermission", async () => {
    const checkPermission = vi.fn(async () => ({ status: "allowed" as const }));
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx({ checkPermission }));

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    await canUseTool(
      "mcp__nexus-kernel-tools__set_job_output",
      { groomed_board_summary: "done" },
      {},
    );

    // The registry knows the canonical name `set_job_output`, not the SDK's
    // mcp-prefixed name — so the engine must normalize before the gate check.
    expect(checkPermission).toHaveBeenCalledWith("set_job_output", {
      groomed_board_summary: "done",
    });
  });

  it("recovers a dotted canonical name from the SDK's underscore-sanitized form", async () => {
    const checkPermission = vi.fn(async () => ({ status: "allowed" as const }));
    const engine = new ClaudeCodeEngine();
    await engine.createSession(
      buildConfig(),
      buildCtx({
        checkPermission,
        // Mounted under the dotted canonical name; the SDK surfaces it as
        // `kanban_project_state` (MCP names cannot contain dots).
        toolCatalog: [makeSpec("kanban.project_state")],
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    await canUseTool(
      "mcp__nexus-kernel-tools__kanban_project_state",
      { project_id: "p1" },
      {},
    );

    // Governance keys this tool as `kanban.project_state`; the underscore form
    // would be rejected as not-registered.
    expect(checkPermission).toHaveBeenCalledWith("kanban.project_state", {
      project_id: "p1",
    });
  });

  it("lowercases SDK-native tool names to the runner-native convention", async () => {
    const checkPermission = vi.fn(async () => ({ status: "allowed" as const }));
    const engine = new ClaudeCodeEngine();
    await engine.createSession(buildConfig(), buildCtx({ checkPermission }));

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    await canUseTool("Bash", { command: "ls" }, {});

    // Governance knows runner-native tools lowercase (`bash`); the PascalCase
    // SDK name would not match the callable set.
    expect(checkPermission).toHaveBeenCalledWith("bash", { command: "ls" });
  });
});
