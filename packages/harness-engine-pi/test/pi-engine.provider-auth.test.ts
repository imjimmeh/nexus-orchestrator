/**
 * Regression test for the OpenAI-compatible provider credential mismatch.
 *
 * For an api_key provider with a custom baseUrl (e.g. "minimax"), PiEngine
 * registers the API key under the synthetic runtime provider "openai" but must
 * build the model object with the SAME provider name. The pi-coding-agent SDK
 * resolves the API key by `model.provider`, so if the custom model keeps the
 * raw DB provider name ("minimax") the key lookup misses and the SDK throws
 * `No API key found for minimax`.
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
    .mockImplementation(function DefaultResourceLoader() {
      return {
        reload: vi.fn().mockResolvedValue(undefined),
      };
    }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue(""),
}));

describe("PiEngine OpenAI-compatible provider auth", () => {
  it("builds the custom model under the same provider the API key is registered under", async () => {
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
        provider: "minimax",
        model: "MiniMax-M1",
        baseUrl: "https://api.minimax.chat/v1",
        auth: { type: "api_key" as const, apiKey: "mm-secret-key" },
      },
      prompt: {
        systemPrompt: "You are a helpful agent.",
        initialPrompt: "Hello",
      },
      harnessOptions: { stepId: "step-minimax" },
    };

    const ctx = {
      governedTools: [],
      toolCatalog: [],
      checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
      workspacePath: "/workspace",
      agentDir: "/opt/harness-runtime/agent",
      extensionsPath: "/opt/harness-runtime/extensions",
      sessionPath: "/opt/harness-runtime/agent/session.jsonl",
    };

    await engine.createSession(runtimeConfig, ctx);

    // The key was registered under the synthetic OpenAI-compat runtime provider.
    expect(mockAuthInstance.setRuntimeApiKey).toHaveBeenCalledWith(
      "openai",
      "mm-secret-key",
    );
    const registeredProvider =
      mockAuthInstance.setRuntimeApiKey.mock.calls[0][0];

    // The model handed to the SDK must carry that SAME provider name, otherwise
    // `getApiKeyAndHeaders(model)` looks up the key by the wrong provider.
    const passedModel = mockCreateAgentSession.mock.calls[0][0].model as {
      provider: string;
    };
    expect(passedModel.provider).toBe(registeredProvider);
  }, 20000);
});
