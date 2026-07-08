/**
 * Tests for ClaudeCodeEngine plugin materialization (Phase 3 / Task 3).
 *
 * Invariants under test:
 * - Empty plugins ⇒ byte-identical query options (NO `plugins` key, no staged files).
 * - One hook+MCP plugin ⇒ staged files written and `options.plugins` set correctly.
 * - Plugin-contributed tool name still routes through `canUseTool`/`checkPermission`.
 * - dispose() removes the staged plugin directory (best-effort, never throws).
 * - checksum_mismatch drop ⇒ console.warn with id/kind/reason, no bundle bytes.
 * - missing_bundle drop ⇒ console.warn with reason missing_bundle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HarnessRuntimeConfig, HarnessPlugin } from "@nexus/core";
import { computeAssetChecksum, EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

// ---------------------------------------------------------------------------
// SDK mock — captures query call options and exposes the written file map.
// ---------------------------------------------------------------------------

const queryCalls: Array<{
  prompt: unknown;
  options?: Record<string, unknown>;
}> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { prompt: unknown; options?: Record<string, unknown> }) => {
    queryCalls.push(opts);
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "ok",
        session_id: "sess-plugins",
      };
    })();
  },
  createSdkMcpServer: (o: unknown) => o,
  tool: (name: string) => ({ name }),
}));

// ---------------------------------------------------------------------------
// fs/promises mock — intercepts mkdir + writeFile; tracks written paths.
// ---------------------------------------------------------------------------

const writtenFiles = new Map<string, string>();
const createdDirs = new Set<string>();
// Tracks paths passed to rm({ recursive: true, force: true }).
const removedPaths: string[] = [];

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async (p: string) => {
    createdDirs.add(p);
  }),
  writeFile: vi.fn(async (p: string, contents: string) => {
    writtenFiles.set(p, contents);
  }),
  rm: vi.fn(async (p: string) => {
    removedPaths.push(p);
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Import SUT AFTER mocks are in place.
// ---------------------------------------------------------------------------

const { ClaudeCodeEngine } = await import("../src/claude-code-engine.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(): HarnessRuntimeConfig {
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

function makeCtx(
  plugins: HarnessPlugin[] = [],
  overrides: Partial<HarnessSessionContext> = {},
): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: vi.fn(async () => ({ status: "allowed" as const })),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath: "/ext",
    sessionPath: "/session.jsonl",
    contributions: {
      ...EMPTY_HARNESS_CONTRIBUTIONS,
      plugins,
    },
    ...overrides,
  };
}

function makeHookMcpPlugin(): HarnessPlugin {
  const capabilities = {
    hooks: [{ event: "pre_tool_use", matcher: "Bash", command: "echo before" }],
    mcpServerRefs: ["srv-001"],
  };
  const manifest = { name: "hook-mcp-plugin" };
  const bundle = JSON.stringify({ capabilities, manifest });
  return {
    id: "plugin-001",
    name: "hook-mcp-plugin",
    version: "1.0.0",
    source: { kind: "authored" },
    checksum: computeAssetChecksum(bundle),
    bundle,
    manifest,
    capabilities,
  };
}

// ---------------------------------------------------------------------------
// Baseline key-set for an empty-contributions session (established in setup).
// ---------------------------------------------------------------------------

const EXPECTED_EMPTY_KEYS = [
  "abortController",
  "canUseTool",
  "cwd",
  "disallowedTools",
  "env",
  "mcpServers",
  "pathToClaudeCodeExecutable",
  "systemPrompt",
].sort();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine plugin materialization — empty set", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    writtenFiles.clear();
    createdDirs.clear();
    removedPaths.length = 0;
  });

  it("empty plugins ⇒ NO `plugins` key on query options (byte-identical)", async () => {
    await new ClaudeCodeEngine().createSession(makeCfg(), makeCtx([]));

    const options = queryCalls[0].options as Record<string, unknown>;
    expect(options.plugins).toBeUndefined();
    expect(Object.keys(options).sort()).toEqual(EXPECTED_EMPTY_KEYS);
  });

  it("empty plugins ⇒ no plugin-related files staged", async () => {
    await new ClaudeCodeEngine().createSession(makeCfg(), makeCtx([]));

    // Only files the engine writes in the no-plugin path are credentials
    // (skipped because auth is api_key with no file delivery) and session
    // (handled by V3SessionWriter, which is mocked to no-op via existsSync:false).
    // In particular, no plugin dir or .claude-plugin/plugin.json must appear.
    const pluginFiles = [...writtenFiles.keys()].filter(
      (p) => p.includes("plugin") || p.includes(".mcp.json"),
    );
    expect(pluginFiles).toHaveLength(0);
  });
});

describe("ClaudeCodeEngine plugin materialization — one hook+MCP plugin", () => {
  const RESOLVED_MCP = {
    id: "srv-001",
    name: "my-mcp-server",
    transportType: "stdio" as const,
    command: "node",
    args: ["server.js"],
    env: { MY_SECRET: "secret-value" },
    timeoutMs: 30_000,
    connectTimeoutMs: 5_000,
  };

  beforeEach(() => {
    queryCalls.length = 0;
    writtenFiles.clear();
    createdDirs.clear();
    removedPaths.length = 0;
  });

  it("sets options.plugins with type:local and the absolute plugin root", async () => {
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [RESOLVED_MCP],
        },
      }),
    );

    const options = queryCalls[0].options as Record<string, unknown>;
    const pluginsOption = options.plugins as Array<{
      type: string;
      path: string;
    }>;
    expect(pluginsOption).toBeDefined();
    expect(pluginsOption).toHaveLength(1);
    expect(pluginsOption[0].type).toBe("local");
    // The path must be absolute (session-scoped under agentDir).
    expect(pluginsOption[0].path).toMatch(/^\/agent/);
    expect(pluginsOption[0].path).toContain("hook-mcp-plugin");
  });

  it("writes .claude-plugin/plugin.json under the plugin root", async () => {
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [RESOLVED_MCP],
        },
      }),
    );

    const manifestPath = [...writtenFiles.keys()].find((p) =>
      p.endsWith(".claude-plugin/plugin.json"),
    );
    expect(manifestPath).toBeDefined();
    const manifest = JSON.parse(writtenFiles.get(manifestPath!)!) as {
      name: string;
    };
    expect(manifest.name).toBe("hook-mcp-plugin");
  });

  it("writes hooks/hooks.json under the plugin root", async () => {
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [RESOLVED_MCP],
        },
      }),
    );

    const hooksPath = [...writtenFiles.keys()].find((p) =>
      p.endsWith("hooks/hooks.json"),
    );
    expect(hooksPath).toBeDefined();
    const hooks = JSON.parse(writtenFiles.get(hooksPath!)!) as Record<
      string,
      unknown
    >;
    expect(hooks).toHaveProperty("PreToolUse");
  });

  it("writes .mcp.json under the plugin root (secret-bearing)", async () => {
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [RESOLVED_MCP],
        },
      }),
    );

    const mcpPath = [...writtenFiles.keys()].find((p) =>
      p.endsWith(".mcp.json"),
    );
    expect(mcpPath).toBeDefined();
    const mcp = JSON.parse(writtenFiles.get(mcpPath!)!) as {
      mcpServers: Record<string, unknown>;
    };
    expect(mcp.mcpServers).toHaveProperty("my-mcp-server");
  });

  it("plugin MCP is NOT added to options.mcpServers (only in staged .mcp.json)", async () => {
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [RESOLVED_MCP],
        },
      }),
    );

    const options = queryCalls[0].options as Record<string, unknown>;
    const mcpServers = options.mcpServers as Record<string, unknown>;
    // Only the nexus kernel server — no plugin MCP servers.
    expect(Object.keys(mcpServers)).toEqual(["nexus-kernel-tools"]);
  });
});

describe("ClaudeCodeEngine plugin governance", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    writtenFiles.clear();
    createdDirs.clear();
    removedPaths.length = 0;
  });

  it("plugin-contributed tool name (mcp__<server>__<tool>) routes through checkPermission", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "denied" as const,
      reason: "blocked",
    }));
    const plugin = makeHookMcpPlugin();
    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        checkPermission,
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [],
        },
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    // A plugin MCP tool — the engine must gate it through the same canUseTool.
    const decision = await canUseTool(
      "mcp__my-mcp-server__do_thing",
      { arg: "val" },
      {},
    );
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
  });
});

describe("ClaudeCodeEngine plugin staging disposal", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    writtenFiles.clear();
    createdDirs.clear();
    removedPaths.length = 0;
  });

  afterEach(() => {
    removedPaths.length = 0;
  });

  it("dispose() removes the staged plugin directory (best-effort)", async () => {
    const plugin = makeHookMcpPlugin();
    const session = await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [],
        },
      }),
    );

    // The plugin root must have been staged.
    const pluginsOption = queryCalls[0]?.options?.plugins as Array<{
      path: string;
    }>;
    const pluginRoot = pluginsOption?.[0]?.path;
    expect(pluginRoot).toBeDefined();

    // Dispose must clean up the staged dir.
    await session.dispose();

    expect(removedPaths).toContain(pluginRoot);
  });

  it("dispose() does not throw even if rm fails (best-effort)", async () => {
    const { rm } = await import("node:fs/promises");
    vi.mocked(rm).mockRejectedValueOnce(new Error("ENOENT"));

    const plugin = makeHookMcpPlugin();
    const session = await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([plugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [plugin],
          resolvedMcpServers: [],
        },
      }),
    );

    // Must not throw.
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Plugin staging drop surfacing (Fix A + Fix B)
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine plugin staging drops are surfaced", () => {
  beforeEach(() => {
    queryCalls.length = 0;
    writtenFiles.clear();
    createdDirs.clear();
    removedPaths.length = 0;
  });

  it("emits console.warn for a checksum_mismatch drop with id, kind, and reason", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const bundle = JSON.stringify({ name: "bad-plugin" });
    const mismatchedPlugin: HarnessPlugin = {
      id: "plugin-tampered-001",
      name: "tampered-plugin",
      version: "1.0.0",
      source: { kind: "authored" },
      // Deliberately wrong checksum.
      checksum:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bundle,
      manifest: { name: "tampered-plugin" },
      capabilities: {},
    };

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([mismatchedPlugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [mismatchedPlugin],
        },
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("plugin-tampered-001"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("checksum_mismatch"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("plugin"));

    warnSpy.mockRestore();
  });

  it("does NOT log bundle bytes for a checksum_mismatch drop", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const bundle = JSON.stringify({ name: "secret-plugin-contents" });
    const mismatchedPlugin: HarnessPlugin = {
      id: "plugin-tampered-002",
      name: "tampered-plugin-2",
      version: "1.0.0",
      source: { kind: "authored" },
      checksum:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      bundle,
      manifest: { name: "tampered-plugin-2" },
      capabilities: {},
    };

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([mismatchedPlugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [mismatchedPlugin],
        },
      }),
    );

    for (const call of warnSpy.mock.calls) {
      const message = String(call[0]);
      expect(message).not.toContain("secret-plugin-contents");
    }

    warnSpy.mockRestore();
  });

  it("emits console.warn with reason missing_bundle for a plugin with no bundle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const bundle = JSON.stringify({ name: "no-bundle-plugin" });
    const noBundlePlugin: HarnessPlugin = {
      id: "plugin-no-bundle-001",
      name: "no-bundle-plugin",
      version: "1.0.0",
      source: { kind: "authored" },
      checksum: computeAssetChecksum(bundle),
      bundle: undefined,
      manifest: { name: "no-bundle-plugin" },
      capabilities: {},
    };

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx([noBundlePlugin], {
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [noBundlePlugin],
        },
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("plugin-no-bundle-001"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing_bundle"),
    );

    warnSpy.mockRestore();
  });

  it("emits no drop warn when all plugins are valid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await new ClaudeCodeEngine().createSession(makeCfg(), makeCtx([]));

    const dropWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("harness_contribution_dropped"),
    );
    expect(dropWarns).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
