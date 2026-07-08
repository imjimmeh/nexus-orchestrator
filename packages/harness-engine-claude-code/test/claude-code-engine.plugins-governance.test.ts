/**
 * Dedicated governance + SPI conformance tests for Claude Code plugin support
 * (Phase 3 / Task 4 — EPIC-211).
 *
 * Invariants under test:
 *
 * GOVERNANCE
 *  G1 — deny path: a plugin-contributed plain tool denied by checkPermission ⇒
 *        canUseTool returns behavior:"deny".
 *  G2 — allow path: an allowed tool ⇒ behavior:"allow" with updatedInput echoed
 *        (required by SDK PermissionResult Zod schema; omitting updatedInput would
 *        cause a ZodError at runtime — see govern.ts comments).
 *  G3 — allow path for mcp__<server>__<tool>: plugin MCP tools route through
 *        the same canUseTool gate as kernel tools.
 *  G4 — ceiling bound: a tool NOT in the resolved job∩profile catalog (toolCatalog)
 *        is denied even if a plugin declares it, because checkPermission is keyed
 *        on the catalog and the ceiling applies universally.
 *
 * SPI CONFORMANCE
 *  S1 — isPluginMaterializer(new ClaudeCodeEngine()) === true.
 *  S2 — CLAUDE_CODE_CAPABILITIES.supportsPlugins === true and the engine
 *        implements PluginMaterializer (capability and SPI agree).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig, HarnessPlugin } from "@nexus/core";
import {
  CLAUDE_CODE_CAPABILITIES,
  computeAssetChecksum,
  EMPTY_HARNESS_CONTRIBUTIONS,
} from "@nexus/core";
import { isPluginMaterializer } from "@nexus/harness-runtime";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

// ---------------------------------------------------------------------------
// SDK mock — captures query call options so tests can inspect canUseTool.
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
        session_id: "sess-gov",
      };
    })();
  },
  createSdkMcpServer: (o: unknown) => o,
  tool: (name: string) => ({ name }),
}));

// ---------------------------------------------------------------------------
// fs/promises mock — silent no-ops so plugin staging does not touch disk.
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Import SUT AFTER mocks are in place.
// ---------------------------------------------------------------------------

const { ClaudeCodeEngine } = await import("../src/claude-code-engine.js");

// ---------------------------------------------------------------------------
// Test helpers
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

/**
 * Build a HarnessSessionContext with the given toolCatalog and checkPermission.
 *
 * toolCatalog simulates the resolved job∩profile catalog — only tools listed
 * here are "allowed" in principle; the checkPermission function determines the
 * final allow/deny decision per-call (so tests can exercise both paths
 * independently of the catalog).
 */
function makeCtx(
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
    contributions: { ...EMPTY_HARNESS_CONTRIBUTIONS },
    ...overrides,
  };
}

function makePlugin(name = "test-plugin"): HarnessPlugin {
  const capabilities = {
    hooks: [{ event: "pre_tool_use", matcher: "Bash", command: "echo before" }],
    mcpServerRefs: [],
  };
  const manifest = { name };
  const bundle = JSON.stringify({ capabilities, manifest });
  return {
    id: "plugin-gov-001",
    name,
    version: "1.0.0",
    source: { kind: "authored" },
    checksum: computeAssetChecksum(bundle),
    bundle,
    manifest,
    capabilities,
  };
}

// ---------------------------------------------------------------------------
// G1–G4: Governance tests
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine plugin governance — deny path (G1)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("a denied checkPermission ⇒ canUseTool returns behavior:deny for a plain plugin tool", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "denied" as const,
      reason: "blocked by policy",
    }));

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx({
        checkPermission,
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [makePlugin()],
        },
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string; message?: string }>;

    const decision = await canUseTool("plugin_tool", { arg: "val" }, {});
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("blocked by policy");
  });
});

describe("ClaudeCodeEngine plugin governance — allow path (G2)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("an allowed checkPermission ⇒ canUseTool returns behavior:allow with updatedInput", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "allowed" as const,
    }));
    const input = { command: "ls -la" };

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx({
        checkPermission,
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [makePlugin()],
        },
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string; updatedInput?: Record<string, unknown> }>;

    const decision = await canUseTool("Bash", input, {});
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("allow");
    // The SDK PermissionResult Zod schema requires `updatedInput` on the allow
    // branch — omitting it causes a ZodError ("Tool permission request failed").
    expect(decision.updatedInput).toEqual(input);
  });
});

describe("ClaudeCodeEngine plugin governance — MCP tool allow path (G3)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("mcp__<server>__<tool> from a plugin routes through the same canUseTool gate", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "allowed" as const,
    }));
    const input = { query: "SELECT 1" };

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx({
        checkPermission,
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [makePlugin()],
        },
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string; updatedInput?: Record<string, unknown> }>;

    // A plugin-declared MCP tool name (the SDK surfaces these as mcp__<server>__<tool>).
    const decision = await canUseTool(
      "mcp__my-plugin-server__run_query",
      input,
      {},
    );
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("allow");
    expect(decision.updatedInput).toEqual(input);
  });
});

describe("ClaudeCodeEngine plugin governance — ceiling bound (G4)", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("a tool absent from the job∩profile catalog is denied even if a plugin declares it", async () => {
    // The catalog is EMPTY — no tools are in the resolved job∩profile set.
    // checkPermission will delegate to the real ceiling enforcement, but since the
    // test mocks checkPermission to return denied (simulating what the real
    // check-permission endpoint returns when a tool is not in the catalog), the
    // key assertion is that the engine does NOT bypass checkPermission for
    // plugin-contributed tools.
    const checkPermission = vi.fn(async (toolName: string) => {
      // Simulate: the catalog does not contain this plugin tool.
      if (toolName === "plugin_exclusive_tool") {
        return { status: "denied" as const, reason: "not in catalog" };
      }
      return { status: "allowed" as const };
    });

    await new ClaudeCodeEngine().createSession(
      makeCfg(),
      makeCtx({
        checkPermission,
        // Empty catalog — the plugin tool is NOT present.
        toolCatalog: [],
        contributions: {
          ...EMPTY_HARNESS_CONTRIBUTIONS,
          plugins: [makePlugin()],
        },
      }),
    );

    const canUseTool = queryCalls[0]?.options?.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string; message?: string }>;

    // A tool contributed by the plugin but not in the catalog must be denied.
    const decision = await canUseTool(
      "plugin_exclusive_tool",
      { arg: "val" },
      {},
    );
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("not in catalog");
  });
});

// ---------------------------------------------------------------------------
// S1–S2: SPI conformance tests
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine SPI conformance — PluginMaterializer (S1, S2)", () => {
  it("S1 — isPluginMaterializer(new ClaudeCodeEngine()) === true", () => {
    expect(isPluginMaterializer(new ClaudeCodeEngine())).toBe(true);
  });

  it("S2 — supportsPlugins:true capability is backed by a real PluginMaterializer (capability and SPI agree)", () => {
    const engine = new ClaudeCodeEngine();
    // The capability declares plugin support.
    expect(CLAUDE_CODE_CAPABILITIES.supportsPlugins).toBe(true);
    // The engine implements the materializer SPI for that capability.
    expect(isPluginMaterializer(engine)).toBe(true);
    // Honesty invariant: every declared capability has a matching materializer.
    // (Mirrors the existing SPI conformance test in claude-code-engine.spi-conformance.spec.ts.)
    if (CLAUDE_CODE_CAPABILITIES.supportsPlugins) {
      expect(isPluginMaterializer(engine)).toBe(true);
    }
  });
});
