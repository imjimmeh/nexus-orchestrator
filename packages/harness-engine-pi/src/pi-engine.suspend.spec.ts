/**
 * Regression guard: PI engine durable-await suspend wiring.
 *
 * Verifies that when a governed tool returns a `terminate: true` result (the
 * runner's signal that the API issued an executionStatus:"suspended" directive
 * for await_agent_workflow / delegate_*), the engine:
 *   1. aborts the in-flight pi AgentSession so no further LLM turn runs, and
 *   2. marks the returned PiHarnessSession suspended so it emits a clean
 *      suspended agent_end that parks the run for durable resume.
 *
 * Without this wiring the pi-coding-agent SDK keeps the turn going and the agent
 * re-calls await_agent_workflow in a loop. See kanban-atuq.
 *
 * Mocks the pi-coding-agent SDK at the module level (same approach as
 * pi-engine.resume.spec.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fsModule from "node:fs";
import type { CanonicalSessionEvent } from "@nexus/core";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before dynamic import of PiEngine.
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
}));

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const BASE_RUNTIME_CONFIG = {
  harnessId: "pi" as const,
  model: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    auth: { type: "api_key" as const, apiKey: "test-key" },
  },
  prompt: {
    systemPrompt: "You are a helpful agent.",
    initialPrompt: "Continue.",
  },
};

type PiToolDefinition = {
  name: string;
  execute: (
    callId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};

interface AgentEventCarrier {
  type: string;
  messages?: unknown[];
  message?: { stopReason?: string };
  willRetry?: boolean;
}

describe("PiEngine — durable-await suspend wiring", () => {
  let engine: Awaited<ReturnType<typeof import("./pi-engine.js")>>["PiEngine"];
  const mockAbort = vi.fn();
  let capturedCustomTools: PiToolDefinition[] = [];
  let capturedRawListener: ((raw: AgentEventCarrier) => void) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedCustomTools = [];
    capturedRawListener = undefined;

    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});
    mockSessionManagerCreate.mockReturnValue({ branch: vi.fn() });
    mockModelRegistryFind.mockReturnValue({
      id: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    });

    mockCreateAgentSession.mockImplementation(
      (config: { customTools?: PiToolDefinition[] }) => {
        capturedCustomTools = config.customTools ?? [];
        return Promise.resolve({
          session: {
            subscribe: vi.fn((fn: (raw: AgentEventCarrier) => void) => {
              capturedRawListener = fn;
              return vi.fn();
            }),
            abort: mockAbort,
            dispose: vi.fn(),
            prompt: vi.fn(),
          },
          modelFallbackMessage: undefined,
        });
      },
    );

    const mod = await import("./pi-engine.js");
    engine = mod.PiEngine;
  });

  function buildCtx(governedTool: unknown) {
    return {
      governedTools: [governedTool] as never,
      toolCatalog: [] as [],
      checkPermission: vi.fn().mockResolvedValue({ status: "allowed" }),
      workspacePath: "/workspace",
      agentDir: "/opt/harness-runtime/agent",
      extensionsPath: "/opt/harness-runtime/extensions",
      sessionPath: "/opt/harness-runtime/agent/session.jsonl",
    };
  }

  it("aborts the agent session and suspends the harness session when a tool returns terminate", async () => {
    const governedTool = {
      name: "await_agent_workflow",
      description: "Await child workflows.",
      parameters: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "suspended" }],
        details: { ok: true },
        terminate: true,
      }),
    };

    const instance = new engine();
    const session = await instance.createSession(
      BASE_RUNTIME_CONFIG,
      buildCtx(governedTool),
    );

    const events: CanonicalSessionEvent[] = [];
    session.subscribe((e) => events.push(e));

    const awaitTool = capturedCustomTools.find(
      (t) => t.name === "await_agent_workflow",
    );
    expect(awaitTool).toBeDefined();

    await awaitTool?.execute("call-1", {});

    // The engine must have aborted the in-flight pi run so the SDK stops.
    expect(mockAbort).toHaveBeenCalledTimes(1);

    // The harness session must now be suspended: a subsequent agent_end is
    // converted into a clean suspended end rather than forwarded as-is.
    capturedRawListener?.({
      type: "agent_end",
      messages: [],
      message: { stopReason: "aborted" },
      willRetry: false,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agent_end",
      output: { ok: true, stopReason: "suspended", suspended: true },
    });
  });

  it("does not abort or suspend for an ordinary (non-terminating) tool result", async () => {
    const governedTool = {
      name: "query_memory",
      description: "Query memory.",
      parameters: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      }),
    };

    const instance = new engine();
    const session = await instance.createSession(
      BASE_RUNTIME_CONFIG,
      buildCtx(governedTool),
    );

    const events: CanonicalSessionEvent[] = [];
    session.subscribe((e) => events.push(e));

    const tool = capturedCustomTools.find((t) => t.name === "query_memory");
    await tool?.execute("call-2", {});

    expect(mockAbort).not.toHaveBeenCalled();

    // A normal agent_end flows through unchanged (not suspended).
    capturedRawListener?.({
      type: "agent_end",
      messages: [],
      message: { stopReason: "end_turn" },
      willRetry: false,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agent_end",
      output: { ok: true, stopReason: "end_turn" },
    });
    expect(
      (events[0] as { output?: { suspended?: boolean } }).output?.suspended,
    ).toBeUndefined();
  });
});
