/**
 * Regression guard: PI engine surfaces extension staging drops.
 *
 * Verifies that when `stageContributions` drops an extension asset due to a
 * checksum mismatch (Gate 2 re-verify), the engine emits a `console.warn`
 * containing the asset id, kind, and reason — and NEVER includes bundle bytes
 * or other secret material.
 *
 * Uses the same module-mock structure as pi-engine.resume.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeAssetChecksum } from "@nexus/core";
import type { HarnessExtensionAsset } from "@nexus/core";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before dynamic import of PiEngine.
// ---------------------------------------------------------------------------

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
  unlinkSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared test config
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  harnessId: "pi" as const,
  model: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    auth: { type: "api_key" as const, apiKey: "test-key" },
  },
  prompt: { systemPrompt: "sys", initialPrompt: "go" },
};

const BASE_CTX = {
  governedTools: [] as [],
  toolCatalog: [] as [],
  checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
  workspacePath: "/workspace",
  agentDir: "/opt/harness-runtime/agent",
  extensionsPath: "/opt/harness-runtime/extensions",
  sessionPath: "/opt/harness-runtime/agent/session.jsonl",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMismatchedExt(id: string): HarnessExtensionAsset {
  const bundle = JSON.stringify({
    runtime: "ts-module",
    entry: "src/index.ts",
    moduleSource: "export default function run() {}",
  });
  return {
    id,
    name: `ext-${id}`,
    runtime: "ts-module",
    entry: "src/index.ts",
    source: { kind: "authored" },
    // Deliberately wrong checksum — triggers checksum_mismatch guard.
    checksum:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    bundle,
    moduleSource: "export default function run() {}",
  };
}

function makeNoBundleExt(id: string): HarnessExtensionAsset {
  const bundle = JSON.stringify({
    runtime: "ts-module",
    entry: "src/index.ts",
    moduleSource: "export default function run() {}",
  });
  return {
    id,
    name: `ext-${id}`,
    runtime: "ts-module",
    entry: "src/index.ts",
    source: { kind: "authored" },
    checksum: computeAssetChecksum(bundle),
    bundle: undefined,
    moduleSource: "export default function run() {}",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiEngine — extension staging drops are surfaced", () => {
  let engine: Awaited<ReturnType<typeof import("./pi-engine.js")>>["PiEngine"];

  beforeEach(async () => {
    vi.clearAllMocks();

    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});

    const mockSmInstance = {
      branch: vi.fn(),
      getLeafEntry: vi.fn().mockReturnValue(undefined),
    };
    mockSessionManagerCreate.mockReturnValue(mockSmInstance);
    mockSessionManagerOpen.mockReturnValue(mockSmInstance);

    mockModelRegistryFind.mockReturnValue({
      id: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    });

    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()) },
      modelFallbackMessage: undefined,
    });

    const mod = await import("./pi-engine.js");
    engine = mod.PiEngine;
  });

  it("emits console.warn for a checksum_mismatch drop with id, kind, and reason", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ext = makeMismatchedExt("tampered-ext-001");

    await new engine().createSession(BASE_CONFIG, {
      ...BASE_CTX,
      contributions: {
        ...EMPTY_HARNESS_CONTRIBUTIONS,
        extensions: [ext],
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("tampered-ext-001"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("checksum_mismatch"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("extension"));
  });

  it("does NOT log bundle bytes for a checksum_mismatch drop", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ext = makeMismatchedExt("tampered-ext-002");

    await new engine().createSession(BASE_CONFIG, {
      ...BASE_CTX,
      contributions: {
        ...EMPTY_HARNESS_CONTRIBUTIONS,
        extensions: [ext],
      },
    });

    for (const call of warnSpy.mock.calls) {
      const message = String(call[0]);
      // The bundle is a JSON string — ensure none of its content leaks
      expect(message).not.toContain("moduleSource");
      expect(message).not.toContain("ts-module");
    }
  });

  it("emits console.warn with reason missing_bundle for an asset with no bundle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ext = makeNoBundleExt("no-bundle-ext-001");

    await new engine().createSession(BASE_CONFIG, {
      ...BASE_CTX,
      contributions: {
        ...EMPTY_HARNESS_CONTRIBUTIONS,
        extensions: [ext],
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no-bundle-ext-001"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing_bundle"),
    );
  });

  it("emits no console.warn when all extensions are valid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await new engine().createSession(BASE_CONFIG, {
      ...BASE_CTX,
      contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    });

    const engineDropWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("harness_contribution_dropped"),
    );
    expect(engineDropWarns).toHaveLength(0);
  });
});
