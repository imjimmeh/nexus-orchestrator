/**
 * PI engine contribution materialization.
 *
 * Verifies that `createSession` materializes harness contributions:
 *  - hooks → a generated `.ts` extension file written into ctx.extensionsPath
 *  - extensions → PI-native extension assets (MCP bridging deferred to Task 5)
 *  - empty bundle → no file written, no tool-set change (byte-identical)
 *
 * Uses a real temp dir for extensionsPath (so the written file is observable)
 * and mocks the pi-coding-agent SDK at the module level, mirroring
 * pi-engine.resume.spec.ts. The MCP bridge is injected via the engine's
 * constructor DI seam so no real MCP server is contacted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "@nexus/harness-runtime";

const mockCreateAgentSession = vi.fn();
const mockModelRegistryFind = vi.fn();
const mockModelRegistryInMemory = vi.fn().mockReturnValue({
  find: mockModelRegistryFind,
  getAll: vi.fn().mockReturnValue([]),
  registerProvider: vi.fn(),
});
const mockSessionManagerCreate = vi.fn();
const mockSessionManagerOpen = vi.fn();
const mockAuthInstance = { setRuntimeApiKey: vi.fn() };

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createCodingTools: vi.fn().mockReturnValue([]),
  createReadOnlyTools: vi.fn().mockReturnValue([]),
  AuthStorage: { inMemory: vi.fn().mockReturnValue(mockAuthInstance) },
  ModelRegistry: { inMemory: mockModelRegistryInMemory },
  SessionManager: {
    open: mockSessionManagerOpen,
    create: mockSessionManagerCreate,
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
  prompt: {
    systemPrompt: "You are a helpful agent.",
    initialPrompt: "Go.",
  },
};

const EMPTY_CONTRIBUTIONS = {
  hooks: [],
  extensions: [],
  plugins: [],
  settings: {},
};

function makeCtx(extensionsPath: string, contributions: unknown) {
  return {
    governedTools: [] as [],
    toolCatalog: [] as [],
    checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath,
    sessionPath: path.join(extensionsPath, "session.jsonl"),
    contributions,
  };
}

describe("PiEngine — contribution materialization", () => {
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
    mockSessionManagerCreate.mockReturnValue({
      branch: vi.fn(),
      getLeafEntry: vi.fn().mockReturnValue(undefined),
    });
    mockCreateAgentSession.mockResolvedValue({
      session: { subscribe: vi.fn(() => vi.fn()), dispose: vi.fn() },
    });
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-contrib-"));
    const mod = await import("../src/pi-engine.js");
    PiEngine = mod.PiEngine;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("implements the hook + extension materializer SPI (not settings)", () => {
    const engine = new PiEngine();
    expect(isHookMaterializer(engine)).toBe(true);
    expect(isExtensionMaterializer(engine)).toBe(true);
    expect(isSettingsMaterializer(engine)).toBe(false);
  });

  it("writes a .ts hook extension file containing pi.on( when hooks are present", async () => {
    const engine = new PiEngine();
    const ctx = makeCtx(tmpDir, {
      ...EMPTY_CONTRIBUTIONS,
      hooks: [{ event: "session_start", command: "echo hi" }],
    });
    await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const contents = files
      .map((f) => readFileSync(path.join(tmpDir, f), "utf-8"))
      .join("\n");
    expect(contents).toContain("pi.on(");
    expect(contents).toContain("export default");
  });

  it("writes NO extension file and adds NO tools for an empty bundle (byte-identical)", async () => {
    const engine = new PiEngine();
    const ctx = makeCtx(tmpDir, EMPTY_CONTRIBUTIONS);
    await engine.createSession(BASE_RUNTIME_CONFIG, ctx);

    expect(readdirSync(tmpDir).filter((f) => f.endsWith(".ts"))).toEqual([]);
    // Tool set is the baseline (no built-ins mocked, no governed tools, no bridged tools).
    const callArgs = mockCreateAgentSession.mock.calls[0][0] as {
      tools: string[];
    };
    expect(callArgs.tools).toEqual([]);
  });
});
