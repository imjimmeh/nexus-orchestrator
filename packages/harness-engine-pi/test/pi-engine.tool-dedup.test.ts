/**
 * Regression test for duplicate tool names in createAgentSession options.
 *
 * When a governed tool shares a name with a PI built-in (e.g. "ead"), the
 * `tools` array passed to the SDK must contain each name exactly once.
 * The `customTools` array carries only the governed implementations.
 *
 * Ported from the pi-runner session-factory regression suite.
 */

import { describe, it, expect, vi } from "vitest";

const mockCreateAgentSession = vi.fn();
const mockAuthStorageInMemory = vi.fn();
const mockModelRegistryFind = vi.fn();
const mockModelRegistryGetAll = vi.fn().mockReturnValue([]);
const mockModelRegistryRegisterProvider = vi.fn();
const mockModelRegistryInMemory = vi.fn().mockReturnValue({
  find: mockModelRegistryFind,
  getAll: mockModelRegistryGetAll,
  registerProvider: mockModelRegistryRegisterProvider,
});
const mockSessionManagerCreate = vi.fn();
const mockSessionManagerOpen = vi.fn();
const mockSettingsManagerInMemory = vi.fn();
const mockAuthInstance = { setRuntimeApiKey: vi.fn() };
const mockSessionManagerInstance = { branch: vi.fn() };

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  // createCodingTools returns "ead" as a built-in — same name a governed tool might use
  createCodingTools: vi.fn().mockReturnValue([
    {
      name: "ead",
      description: "read a file",
      parameters: {},
      execute: vi.fn(),
    },
    {
      name: "bash",
      description: "run a command",
      parameters: {},
      execute: vi.fn(),
    },
  ]),
  createReadOnlyTools: vi.fn().mockReturnValue([
    {
      name: "read",
      description: "read a file (ro)",
      parameters: {},
      execute: vi.fn(),
    },
  ]),
  AuthStorage: { inMemory: mockAuthStorageInMemory },
  ModelRegistry: { inMemory: mockModelRegistryInMemory },
  SessionManager: {
    open: mockSessionManagerOpen,
    create: mockSessionManagerCreate,
  },
  SettingsManager: { inMemory: mockSettingsManagerInMemory },
  DefaultResourceLoader: vi
    .fn()
    .mockImplementation(function DefaultResourceLoader() {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue(""),
}));

describe("PiEngine tool deduplication", () => {
  it("passes each tool name to createAgentSession exactly once when a governed tool overlaps a built-in", async () => {
    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});
    mockSessionManagerCreate.mockReturnValue(mockSessionManagerInstance);
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()) },
      modelFallbackMessage: undefined,
    });
    mockModelRegistryFind.mockReturnValue({
      id: "claude-sonnet-4-5",
      provider: "anthropic",
    });

    const { PiEngine } = await import("../src/pi-engine.js");
    const engine = new PiEngine();

    const runtimeConfig = {
      harnessId: "pi" as const,
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        auth: { type: "api_key" as const, apiKey: "test-key" },
      },
      prompt: { systemPrompt: "You are an agent.", initialPrompt: "Go" },
    };

    const ctx = {
      // "ead" also exists as a built-in — this is the overlap case from the old bug
      governedTools: [
        {
          name: "ead",
          description: "governed ead (should not duplicate the built-in)",
          parameters: { type: "object" as const, properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
        {
          name: "query_memory",
          description: "governed memory query",
          parameters: { type: "object" as const, properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
      ],
      toolCatalog: [],
      checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
      workspacePath: "/workspace",
      agentDir: "/opt/harness-runtime/agent",
      extensionsPath: "/opt/harness-runtime/extensions",
      sessionPath: "/opt/harness-runtime/agent/session.jsonl",
    };

    await engine.createSession(runtimeConfig, ctx);

    const passed = mockCreateAgentSession.mock.calls[0][0] as {
      tools: string[];
      customTools: Array<{ name: string }>;
    };

    // Each tool name must appear exactly once — no duplicates from overlap
    const toolCounts = passed.tools.reduce<Record<string, number>>(
      (acc, name) => {
        acc[name] = (acc[name] ?? 0) + 1;
        return acc;
      },
      {},
    );
    const duplicated = Object.entries(toolCounts)
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    expect(duplicated).toEqual([]);

    // "ead" appears in tools (from the merged dedup set)
    expect(passed.tools).toContain("ead");
    // "query_memory" appears (governed-only tool)
    expect(passed.tools).toContain("query_memory");

    // customTools carries only the governed tools
    expect(passed.customTools.map((t) => t.name)).toContain("ead");
    expect(passed.customTools.map((t) => t.name)).toContain("query_memory");
  }, 20000);

  it("passes ModelRegistry.inMemory as a static factory — not as a constructor", async () => {
    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});
    mockSessionManagerCreate.mockReturnValue(mockSessionManagerInstance);
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()) },
      modelFallbackMessage: undefined,
    });
    mockModelRegistryFind.mockReturnValue({
      id: "claude-sonnet-4-5",
      provider: "anthropic",
    });

    const { PiEngine } = await import("../src/pi-engine.js");
    const engine = new PiEngine();

    await engine.createSession(
      {
        harnessId: "pi" as const,
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          auth: { type: "api_key" as const, apiKey: "k" },
        },
        prompt: { systemPrompt: "sys", initialPrompt: "go" },
      },
      {
        governedTools: [],
        toolCatalog: [],
        checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
        workspacePath: "/workspace",
        agentDir: "/opt/harness-runtime/agent",
        extensionsPath: "/opt/harness-runtime/extensions",
        sessionPath: "/opt/harness-runtime/agent/session.jsonl",
      },
    );

    // Must be called as a static factory, never as `new ModelRegistry(...)`
    expect(mockModelRegistryInMemory).toHaveBeenCalled();
  }, 20000);
});
