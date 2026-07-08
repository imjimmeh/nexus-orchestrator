/**
 * PI engine conformance test.
 *
 * Mocking strategy
 * ----------------
 * The PiEngine imports heavily from @earendil-works/pi-coding-agent:
 *   - createAgentSession   — creates the SDK session
 *   - createCodingTools, createReadOnlyTools — built-in tool factories
 *   - AuthStorage, ModelRegistry, SessionManager, SettingsManager,
 *     DefaultResourceLoader — infrastructure utilities
 *
 * We mock the entire module via vi.mock so that:
 *   1. createAgentSession returns a FakePiAgentSession wrapping scripted events
 *   2. All infrastructure helpers return no-op stubs
 *
 * Cases covered
 * -------------
 * C1 — validate() returns { ok: true } for a valid config
 * C2 — createSession() returns a HarnessSession with subscribe/prompt/abort/dispose
 * C3 — session emits turn_start
 * C4 — tool_execution_start carries toolCallId, toolName, args
 * C5 — tool_execution_end carries toolCallId, isError
 * C6 — agent_end carries output.{ ok, response, stopReason }
 * C7 — governance deny prevents governed tool execute and calls checkPermission
 * C8 — api_key auth calls authStorage.setRuntimeApiKey with the provider and key
 * C9 — oauth auth seeds AuthStorage.inMemory with the upstream OAuth credential
 *
 * Note: C7 for PI exercises governance directly at the CanonicalToolDefinition
 * level. Because PI governance is external to the engine (the kernel wraps tools
 * via wrapToolWithGovernance before placing them in ctx.governedTools), and the
 * scripted FakePiAgentSession emits events without invoking tool execute, the
 * test calls the governed tool's execute directly to verify that checkPermission
 * is invoked and the underlying tool is blocked when denied.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanonicalSessionEvent } from "@nexus/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import { FakePiAgentSession, makeScriptedPiEvents } from "./fixtures/pi.js";

// ---------------------------------------------------------------------------
// Mock @earendil-works/pi-coding-agent before any engine import
// ---------------------------------------------------------------------------

let activeSession: FakePiAgentSession | null = null;
let scriptedEvents = makeScriptedPiEvents();

/** The AuthStorage stub instance most recently created via AuthStorage.inMemory(). */
let lastAuthStorageStub: {
  setRuntimeApiKey: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
} | null = null;

/** The initialCredentials argument most recently passed to AuthStorage.inMemory(). */
let lastAuthStorageInitArg: unknown = undefined;

vi.mock("@earendil-works/pi-coding-agent", () => {
  const makeAuthStub = (initArg?: unknown) => {
    lastAuthStorageInitArg = initArg;
    const stub = {
      setRuntimeApiKey: vi.fn(),
      registerProvider: vi.fn(),
      find: vi.fn(() => ({ id: "claude-opus-4-8", provider: "anthropic" })),
      getAll: vi.fn(() => [{ id: "claude-opus-4-8", provider: "anthropic" }]),
    };
    lastAuthStorageStub = stub;
    return stub;
  };

  const inMemoryModelStub = () => ({
    setRuntimeApiKey: vi.fn(),
    registerProvider: vi.fn(),
    find: vi.fn(() => ({ id: "claude-opus-4-8", provider: "anthropic" })),
    getAll: vi.fn(() => [{ id: "claude-opus-4-8", provider: "anthropic" }]),
  });

  return {
    createAgentSession: vi.fn(() => {
      activeSession = new FakePiAgentSession(scriptedEvents);
      return Promise.resolve({ session: activeSession });
    }),
    createCodingTools: vi.fn(() => []),
    createReadOnlyTools: vi.fn(() => []),
    AuthStorage: {
      inMemory: vi.fn((initArg?: unknown) => makeAuthStub(initArg)),
    },
    ModelRegistry: {
      inMemory: vi.fn(inMemoryModelStub),
    },
    SessionManager: {
      create: vi.fn(() => ({})),
      open: vi.fn(() => ({ branch: vi.fn() })),
    },
    SettingsManager: {
      inMemory: vi.fn(() => ({})),
    },
    DefaultResourceLoader: class DefaultResourceLoader {
      readonly options: unknown;
      constructor(options: unknown) {
        this.options = options;
      }
      // PiEngine.createSession awaits `resourceLoader.reload()`; the real
      // class implements it but the harness-conformance mock omits the method,
      // which surfaces as `resourceLoader.reload is not a function` in tests.
      // The actual loader isn't used by the conformance suite — only its
      // identity — so the resolved promise is sufficient.
      async reload(): Promise<void> {}
    },
  };
});

// Mock node:fs so SessionManager.create is always called (no existing session file)
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
  };
});

// ---------------------------------------------------------------------------
// Import engine AFTER mocks are registered
// ---------------------------------------------------------------------------

import { PiEngine } from "@nexus/harness-engine-pi";
import {
  makeMockContext,
  makePiConfig,
  makePiConfigWithAuth,
  API_KEY_AUTH_FIXTURE,
  OAUTH_AUTH_FIXTURE,
  collectEvents,
} from "./conformance-suite.js";
import { wrapToolWithGovernance } from "@nexus/harness-runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEngine(): PiEngine {
  return new PiEngine();
}

function collectEventsFromSession(
  session: {
    subscribe: (handler: (e: CanonicalSessionEvent) => void) => () => void;
  },
  timeoutMs = 2000,
): Promise<CanonicalSessionEvent[]> {
  return collectEvents(
    session as Parameters<typeof collectEvents>[0],
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PI Engine Conformance Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSession = null;
    scriptedEvents = makeScriptedPiEvents();
    lastAuthStorageStub = null;
    lastAuthStorageInitArg = undefined;
  });

  // C1
  it("C1 — validate() returns ok:true for valid config", () => {
    const engine = createEngine();
    const result = engine.validate(makePiConfig());
    expect(result.ok).toBe(true);
  });

  // C2
  it("C2 — createSession() returns a HarnessSession with required methods", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makePiConfig(), ctx);

    expect(typeof session.subscribe).toBe("function");
    expect(typeof session.prompt).toBe("function");
    expect(typeof session.abort).toBe("function");
    expect(typeof session.dispose).toBe("function");

    await session.dispose();
  });

  // C3
  it("C3 — session emits turn_start event", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makePiConfig(), ctx);
    const events = await collectEventsFromSession(session);

    expect(events.some((e) => e.type === "turn_start")).toBe(true);
  });

  // C4
  it("C4 — tool_execution_start event includes toolCallId, toolName, args", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makePiConfig(), ctx);
    const events = await collectEventsFromSession(session);

    const startEvent = events.find((e) => e.type === "tool_execution_start");
    expect(startEvent).toBeDefined();
    if (startEvent?.type === "tool_execution_start") {
      expect(typeof startEvent.toolCallId).toBe("string");
      expect(typeof startEvent.toolName).toBe("string");
      expect(typeof startEvent.args).toBe("object");
    }
  });

  // C5
  it("C5 — tool_execution_end event includes toolCallId, isError", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makePiConfig(), ctx);
    const events = await collectEventsFromSession(session);

    const endEvent = events.find((e) => e.type === "tool_execution_end");
    expect(endEvent).toBeDefined();
    if (endEvent?.type === "tool_execution_end") {
      expect(typeof endEvent.toolCallId).toBe("string");
      expect(typeof endEvent.isError).toBe("boolean");
    }
  });

  // C6
  it("C6 — agent_end event includes output.ok, output.response, output.stopReason", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    const session = await engine.createSession(makePiConfig(), ctx);
    const events = await collectEventsFromSession(session);

    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
    if (agentEnd?.type === "agent_end") {
      expect(typeof agentEnd.output.ok).toBe("boolean");
      expect(typeof agentEnd.output.response).toBe("string");
      expect(typeof agentEnd.output.stopReason).toBe("string");
    }
  });

  // C7
  it("C7 — governance deny prevents governed tool execute and calls checkPermission", async () => {
    // Use the tool-containing scripted sequence so the session exercises the
    // tool path. PI governance is external to the engine: the kernel wraps
    // CanonicalToolDefinitions with wrapToolWithGovernance before placing them
    // in ctx.governedTools. The PI engine then converts those wrapped tools to
    // PI ToolDefinitions whose execute delegates back to the governed execute.
    //
    // The scripted FakePiAgentSession emits events directly (bypassing execute),
    // so we validate governance by calling the governed tool execute directly —
    // the same path the PI SDK would take during a real session.
    scriptedEvents = makeScriptedPiEvents();

    const innerExecute = vi.fn(() => Promise.resolve("result"));
    const checkPermission = vi.fn(() =>
      Promise.resolve({
        status: "denied" as const,
        reason: "Not permitted by policy",
      }),
    );

    const rawTool = {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
      execute: innerExecute,
    };
    const governedTool = wrapToolWithGovernance(rawTool, checkPermission);

    const ctx = makeMockContext({
      governedTools: [governedTool],
      checkPermission,
    });

    const engine = createEngine();
    await engine.createSession(makePiConfig(), ctx);

    // Directly invoke the governed tool execute to verify governance blocks it.
    // This mirrors the call path the PI SDK takes when it invokes a customTool.
    const result = await governedTool.execute("call-1", { path: "/README.md" });

    // checkPermission must have been called for the tool invocation
    expect(checkPermission).toHaveBeenCalledWith("read_file", {
      path: "/README.md",
    });

    // The underlying execute must NOT have been called — governance blocked it
    expect(innerExecute).not.toHaveBeenCalled();

    // The result must carry the denial details
    const resultObj = result as { details?: { ok?: boolean; error?: string } };
    expect(resultObj.details?.ok).toBe(false);
    expect(resultObj.details?.error).toBe("permission_denied");
  });

  // C8
  it("C8 — api_key auth calls authStorage.setRuntimeApiKey with provider and key", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    await engine.createSession(makePiConfigWithAuth(API_KEY_AUTH_FIXTURE), ctx);

    expect(lastAuthStorageStub).not.toBeNull();
    expect(lastAuthStorageStub!.setRuntimeApiKey).toHaveBeenCalledWith(
      "anthropic",
      "conformance-api-key",
    );
  });

  // C9
  it("C9 — oauth auth seeds AuthStorage.inMemory with the upstream OAuth credential", async () => {
    const engine = createEngine();
    const ctx = makeMockContext();
    await engine.createSession(makePiConfigWithAuth(OAUTH_AUTH_FIXTURE), ctx);

    // For oauth, the engine passes credentials directly to AuthStorage.inMemory()
    // instead of calling setRuntimeApiKey afterwards.
    expect(lastAuthStorageInitArg).toMatchObject({
      anthropic: {
        type: "oauth",
        refresh: "refresh-xyz",
        access: "access-abc",
        expires: 9_999_999_999_000,
      },
    });
    expect(lastAuthStorageStub).not.toBeNull();
    expect(lastAuthStorageStub!.setRuntimeApiKey).not.toHaveBeenCalled();
  });
});
