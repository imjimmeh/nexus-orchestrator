/**
 * Regression test for LLM providers that reject tool names containing dots.
 *
 * Providers such as DeepSeek enforce the OpenAI tool-name pattern
 * ^[a-zA-Z0-9_-]+$ and return a 400 when a name like "kanban.project_state"
 * is sent. PiEngine must sanitize governed tool names before handing them to
 * the pi-coding-agent SDK while still invoking the original tool execute
 * functions and preserving original names in telemetry.
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

const mockDefaultResourceLoaderCalls: Array<{ systemPrompt?: string }> = [];

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createCodingTools: vi.fn().mockReturnValue([]),
  createReadOnlyTools: vi.fn().mockReturnValue([]),
  AuthStorage: { inMemory: mockAuthStorageInMemory },
  ModelRegistry: { inMemory: mockModelRegistryInMemory },
  SessionManager: {
    open: mockSessionManagerOpen,
    create: mockSessionManagerCreate,
  },
  SettingsManager: { inMemory: mockSettingsManagerInMemory },
  DefaultResourceLoader: vi
    .fn()
    .mockImplementation(function DefaultResourceLoader(args: {
      systemPrompt?: string;
    }) {
      mockDefaultResourceLoaderCalls.push(args);
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

describe("PiEngine tool name sanitization", () => {
  it("replaces dots in governed tool names before passing them to the SDK", async () => {
    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});
    mockSessionManagerCreate.mockReturnValue(mockSessionManagerInstance);
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()) },
      modelFallbackMessage: undefined,
    });

    const { PiEngine } = await import("../src/pi-engine.js");
    const engine = new PiEngine();

    const runtimeConfig = {
      harnessId: "pi" as const,
      model: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/v1",
        auth: { type: "api_key" as const, apiKey: "ds-secret-key" },
      },
      prompt: {
        systemPrompt:
          "Call kanban.project_state and kanban.orchestration_timeline.",
        initialPrompt: "Hello",
      },
      harnessOptions: { stepId: "step-decide" },
    };

    const ctx = {
      governedTools: [
        {
          name: "kanban.project_state",
          description: "Reads project board state.",
          parameters: { type: "object" as const, properties: {} },
          execute: vi.fn().mockResolvedValue({ ok: true }),
        },
        {
          name: "kanban.orchestration_timeline",
          description: "Reads orchestration timeline.",
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
      customTools: Array<{ name: string; label: string }>;
    };

    expect(passed.tools).toEqual([
      "kanban_project_state",
      "kanban_orchestration_timeline",
    ]);
    expect(passed.customTools.map((t) => t.name)).toEqual([
      "kanban_project_state",
      "kanban_orchestration_timeline",
    ]);
    expect(passed.customTools.map((t) => t.label)).toEqual([
      "kanban_project_state",
      "kanban_orchestration_timeline",
    ]);

    expect(mockDefaultResourceLoaderCalls[0]?.systemPrompt).toBe(
      "Call kanban_project_state and kanban_orchestration_timeline.",
    );
  }, 20000);
});
