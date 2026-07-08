/**
 * The PI SDK executes built-in coding tools (read/write/edit/bash/ls/find/grep)
 * by name, inside the SDK, without routing each call through Nexus governance.
 * The API writes the policy-resolved subset of those tools to
 * `_sdk_tool_allowlist.json` in the tool mount; PiEngine must read it and filter
 * its built-in tool set so workflow/profile `tool_policy` is enforced.
 *
 * Regression: run daddd044 used `bash` 37x even though its workflow allowlist
 * granted only read/ls — the engine ignored the allowlist entirely.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ALLOWLIST_PATH =
  "/opt/harness-runtime/extensions/_sdk_tool_allowlist.json";

const mockCreateAgentSession = vi.fn();
const mockAuthInstance = { setRuntimeApiKey: vi.fn() };
const mockAuthStorageInMemory = vi.fn().mockReturnValue(mockAuthInstance);
const mockModelRegistryFind = vi.fn().mockReturnValue({
  id: "claude-sonnet-4-5",
  provider: "anthropic",
});
const mockModelRegistryInMemory = vi.fn().mockReturnValue({
  find: mockModelRegistryFind,
  getAll: vi.fn().mockReturnValue([]),
  registerProvider: vi.fn(),
});
const mockSessionManagerCreate = vi.fn().mockReturnValue({ branch: vi.fn() });

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createCodingTools: vi.fn().mockReturnValue([
    { name: "read", description: "", parameters: {}, execute: vi.fn() },
    { name: "write", description: "", parameters: {}, execute: vi.fn() },
    { name: "edit", description: "", parameters: {}, execute: vi.fn() },
    { name: "bash", description: "", parameters: {}, execute: vi.fn() },
  ]),
  createReadOnlyTools: vi.fn().mockReturnValue([
    { name: "ls", description: "", parameters: {}, execute: vi.fn() },
    { name: "grep", description: "", parameters: {}, execute: vi.fn() },
  ]),
  AuthStorage: { inMemory: mockAuthStorageInMemory },
  ModelRegistry: { inMemory: mockModelRegistryInMemory },
  SessionManager: {
    open: vi.fn(),
    create: mockSessionManagerCreate,
  },
  SettingsManager: { inMemory: vi.fn().mockReturnValue({}) },
  DefaultResourceLoader: vi
    .fn()
    .mockImplementation(function DefaultResourceLoader() {
      return { reload: vi.fn().mockResolvedValue(undefined) };
    }),
}));

// Allowlist file present by default; individual tests override existsSync.
const mockExistsSync = vi.fn((p: string) => p === ALLOWLIST_PATH);
const mockReadFileSync = vi.fn((p: string) =>
  p === ALLOWLIST_PATH ? JSON.stringify(["read", "ls"]) : "",
);
vi.mock("node:fs", () => ({
  existsSync: (p: string) => mockExistsSync(p),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: (p: string) => mockReadFileSync(p),
}));

const runtimeConfig = {
  harnessId: "pi" as const,
  model: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    auth: { type: "api_key" as const, apiKey: "test-key" },
  },
  prompt: { systemPrompt: "You are an agent.", initialPrompt: "Go" },
};

function makeCtx() {
  return {
    governedTools: [
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
}

async function createSessionAndReadTools(): Promise<string[]> {
  mockCreateAgentSession.mockResolvedValue({
    session: { subscribe: vi.fn(() => vi.fn()) },
    modelFallbackMessage: undefined,
  });
  const { PiEngine } = await import("../src/pi-engine.js");
  await new PiEngine().createSession(runtimeConfig, makeCtx());
  const passed = mockCreateAgentSession.mock.calls[0][0] as {
    tools: string[];
  };
  return passed.tools;
}

describe("PiEngine SDK coding-tool allowlist enforcement", () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockExistsSync.mockImplementation((p: string) => p === ALLOWLIST_PATH);
    mockReadFileSync.mockImplementation((p: string) =>
      p === ALLOWLIST_PATH ? JSON.stringify(["read", "ls"]) : "",
    );
  });

  it("registers only allowlisted built-in coding tools", async () => {
    const tools = await createSessionAndReadTools();

    expect(tools).toContain("read");
    expect(tools).toContain("ls");
    // Denied built-ins must NOT reach the SDK.
    expect(tools).not.toContain("bash");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("grep");
  });

  it("never filters governed tools by the coding-tool allowlist", async () => {
    const tools = await createSessionAndReadTools();
    // query_memory is governed (API-filtered) and absent from the allowlist,
    // but must still be registered.
    expect(tools).toContain("query_memory");
  });

  it("applies no built-in restriction when the allowlist file is absent", async () => {
    mockExistsSync.mockReturnValue(false);
    const tools = await createSessionAndReadTools();

    expect(tools).toContain("read");
    expect(tools).toContain("bash");
    expect(tools).toContain("write");
    expect(tools).toContain("query_memory");
  });
});
