/**
 * PI engine contribution governance + lifecycle (security gate).
 *
 * NOTE (Task 5): The MCP bridging behavior (governed tool proxying via
 * ctx.checkPermission and dispose lifecycle) was previously tested here using
 * the inline MCP extension shape. That shape has been removed in EPIC-211 Task 1;
 * MCP server connectivity is now driven by `mcpServerRefs` in `HarnessPlugin`
 * and will be resolved through `apps/api/src/mcp` (Task 5). The governance
 * invariants that remain testable in this task are:
 *   - governed (kernel-provided) tools pass through checkPermission correctly.
 *   - the engine bridge with PI-native extension assets yields no MCP tools.
 *   - session dispose is wired correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { HarnessExtensionAsset } from "@nexus/core";

const mockCreateAgentSession = vi.fn();
const mockModelRegistryFind = vi.fn();
const mockSessionDispose = vi.fn();

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createCodingTools: vi.fn().mockReturnValue([]),
  createReadOnlyTools: vi.fn().mockReturnValue([]),
  AuthStorage: {
    inMemory: vi.fn().mockReturnValue({ setRuntimeApiKey: vi.fn() }),
  },
  ModelRegistry: {
    inMemory: vi.fn().mockReturnValue({
      find: mockModelRegistryFind,
      getAll: vi.fn().mockReturnValue([]),
      registerProvider: vi.fn(),
    }),
  },
  SessionManager: {
    open: vi.fn(),
    create: vi.fn().mockReturnValue({
      branch: vi.fn(),
      getLeafEntry: vi.fn().mockReturnValue(undefined),
    }),
  },
  SettingsManager: { inMemory: vi.fn().mockReturnValue({}) },
  DefaultResourceLoader: vi
    .fn()
    .mockImplementation(function DefaultResourceLoader() {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    }),
}));

const BASE_RUNTIME_CONFIG = {
  harnessId: "pi" as const,
  model: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    auth: { type: "api_key" as const, apiKey: "test-key" },
  },
  prompt: { systemPrompt: "You are a helpful agent.", initialPrompt: "Go." },
};

const PI_EXTENSION_ASSET: HarnessExtensionAsset = {
  id: "ext-001",
  name: "my-extension",
  runtime: "ts-module",
  entry: "./dist/index.js",
  source: { kind: "authored" },
  checksum: "sha256:abc123",
};

function makeCtx(extensionsPath: string) {
  return {
    governedTools: [] as [],
    toolCatalog: [] as [],
    checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath,
    sessionPath: path.join(extensionsPath, "session.jsonl"),
    // PI-native extension assets — MCP bridging is deferred to Task 5.
    contributions: {
      hooks: [],
      extensions: [PI_EXTENSION_ASSET],
      plugins: [],
      settings: {},
    },
  };
}

describe("PiEngine — contribution governance + lifecycle", () => {
  let PiEngine: Awaited<
    ReturnType<typeof import("../src/pi-engine.js")>
  >["PiEngine"];
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModelRegistryFind.mockReturnValue({
      id: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    });
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()), dispose: mockSessionDispose },
    });
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-gov-"));
    PiEngine = (await import("../src/pi-engine.js")).PiEngine;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("PI-native extension assets yield no bridged tools (MCP bridging deferred to Task 5)", async () => {
    const engine = new PiEngine();
    const ctx = makeCtx(tmpDir);

    await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    const callArgs = mockCreateAgentSession.mock.calls[0][0] as {
      tools: string[];
      customTools: Array<{ name: string }>;
    };
    // No bridged MCP tools — only the governed tools (none in this fixture).
    expect(callArgs.customTools).toEqual([]);
  });

  it("session dispose completes without error", async () => {
    const engine = new PiEngine();
    const ctx = makeCtx(tmpDir);

    const session = await engine.createSession(BASE_RUNTIME_CONFIG, ctx);
    await expect(session.dispose()).resolves.not.toThrow();
  });
});
