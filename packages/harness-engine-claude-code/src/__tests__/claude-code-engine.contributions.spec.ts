import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig, HarnessExtensionAsset } from "@nexus/core";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

const queryCalls: Array<{
  prompt: unknown;
  options?: Record<string, unknown>;
}> = [];
const sdkMessages: unknown[] = [
  { type: "result", subtype: "success", result: "ok", session_id: "s1" },
];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { prompt: unknown; options?: Record<string, unknown> }) => {
    queryCalls.push(opts);
    return (async function* () {
      for (const m of sdkMessages) yield m;
    })();
  },
  createSdkMcpServer: (o: unknown) => o,
  tool: (name: string) => ({ name }),
}));

const { ClaudeCodeEngine } = await import("../claude-code-engine.js");

function cfg(): HarnessRuntimeConfig {
  return {
    harnessId: "claude-code",
    model: {
      provider: "anthropic",
      model: "m",
      auth: { type: "api_key", apiKey: "k" },
    },
    prompt: { systemPrompt: "sys", initialPrompt: "go" },
  };
}

function ctx(
  contributions: HarnessSessionContext["contributions"],
): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: vi.fn(async () => ({ status: "allowed" as const })),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath: "/ext",
    sessionPath: "/session.jsonl",
    contributions,
  };
}

const empty: HarnessSessionContext["contributions"] = {
  hooks: [],
  extensions: [],
  plugins: [],
  settings: {},
};

const piExtAsset: HarnessExtensionAsset = {
  id: "ext-001",
  name: "my-extension",
  runtime: "ts-module",
  entry: "./dist/index.js",
  source: { kind: "authored" },
  checksum: "sha256:abc123",
};

describe("ClaudeCodeEngine contribution merge", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("adds NO contribution keys when the bundle is empty", async () => {
    await new ClaudeCodeEngine().createSession(cfg(), ctx(empty));
    const options = queryCalls[0].options!;
    expect(options.hooks).toBeUndefined();
    expect(options.settings).toBeUndefined();
    // only the kernel MCP server is present
    expect(Object.keys(options.mcpServers as object)).toEqual([
      "nexus-kernel-tools",
    ]);
  });

  it("produces byte-identical query options for an empty bundle (no behavior change)", async () => {
    await new ClaudeCodeEngine().createSession(cfg(), ctx(empty));
    const options = queryCalls[0].options!;
    // The only contribution-derived keys the merge could add are hooks /
    // settings / extra mcpServers / env-patch. With an empty bundle the set of
    // option keys must be exactly the pre-contribution set.
    expect(Object.keys(options).sort()).toEqual(
      [
        "abortController",
        "canUseTool",
        "cwd",
        "disallowedTools",
        "env",
        "mcpServers",
        "pathToClaudeCodeExecutable",
        "systemPrompt",
      ].sort(),
    );
    // env must be exactly process.env + the auth env (ANTHROPIC_API_KEY="k"),
    // with NO contribution env-patch keys added.
    expect(options.env).toEqual({ ...process.env, ANTHROPIC_API_KEY: "k" });
  });

  it("does NOT add mcpServers for PI-native extension assets (MCP bridging deferred to Task 5)", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        extensions: [piExtAsset],
      }),
    );
    const servers = queryCalls[0].options!.mcpServers as Record<
      string,
      unknown
    >;
    // Only the kernel server — no extra MCP servers from PI-native extension assets.
    expect(Object.keys(servers)).toEqual(["nexus-kernel-tools"]);
  });

  it("adds options.hooks for authored command hooks", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        hooks: [{ event: "session_start", command: "echo hi" }],
      }),
    );
    expect(queryCalls[0].options!.hooks).toBeDefined();
    expect(Object.keys(queryCalls[0].options!.hooks as object)).toEqual([
      "SessionStart",
    ]);
  });

  it("adds options.hooks for authored script hooks", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        hooks: [
          {
            event: "pre_tool_use",
            script: { language: "bash", source: "echo checking" },
          },
        ],
      }),
    );
    expect(queryCalls[0].options!.hooks).toBeDefined();
    expect(Object.keys(queryCalls[0].options!.hooks as object)).toEqual([
      "PreToolUse",
    ]);
  });

  it("adds options.settings and patches env for settings contributions", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        settings: { outputStyle: "concise", env: { FOO: "bar" } },
      }),
    );
    expect(queryCalls[0].options!.settings).toEqual({ outputStyle: "concise" });
    expect((queryCalls[0].options!.env as Record<string, string>).FOO).toBe(
      "bar",
    );
  });

  it("implements the three materializer interfaces", () => {
    const e = new ClaudeCodeEngine() as unknown as Record<string, unknown>;
    expect(typeof e.materializeHooks).toBe("function");
    expect(typeof e.materializeExtensions).toBe("function");
    expect(typeof e.materializeSettings).toBe("function");
  });
});

describe("ClaudeCodeEngine governance over kernel MCP tools", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("canUseTool is wired for kernel-side governance", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "denied" as const,
      reason: "blocked",
    }));
    const sessionCtx: HarnessSessionContext = {
      ...ctx(empty),
      checkPermission,
    };
    await new ClaudeCodeEngine().createSession(cfg(), sessionCtx);

    const canUseTool = queryCalls[0].options!.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    const decision = await canUseTool("some_kernel_tool", { arg: "val" }, {});
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
  });
});
