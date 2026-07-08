/**
 * Golden-path characterization test for PiEngine end-to-end event mapping.
 *
 * Drives PiEngine.createSession with a mocked AgentSession that emits the same
 * scripted event sequence as the pi-runner golden-path test:
 *
 *   turn_start
 *   tool_execution_start  (bash / ls)
 *   tool_execution_end    (bash / ls → "file1.txt")
 *   turn_end              (stopReason: "end_turn", text: "Hello")
 *   agent_end             (terminal message: "Done")
 *
 * Canonical events collected via subscribe() are snapshotted to guard against
 * regressions in the event-mapping layer.
 */

import { describe, it, expect, vi } from "vitest";
import type { CanonicalSessionEvent } from "@nexus/core";

// ---------------------------------------------------------------------------
// SDK mock — hoisted so vi.mock runs before imports
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

// ---------------------------------------------------------------------------
// Fake session helpers
// ---------------------------------------------------------------------------

type EventListener = (event: Record<string, unknown>) => void;

function createScriptedFakeSession() {
  let listener: EventListener | null = null;

  const session = {
    subscribe(fn: EventListener): () => void {
      listener = fn;
      return vi.fn(() => {
        listener = null;
      });
    },

    async emitScriptedEvents(): Promise<void> {
      if (!listener) {
        throw new Error("emitScriptedEvents called before subscribe");
      }
      const emit = listener;

      emit({ type: "turn_start" });

      emit({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "ls" },
      });

      emit({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: "file1.txt",
        isError: false,
      });

      emit({
        type: "turn_end",
        message: { stopReason: "end_turn", text: "Hello" },
        toolResults: [],
      });

      emit({
        type: "agent_end",
        messages: [{ content: [{ type: "text", text: "Done" }] }],
      });
    },

    prompt: vi.fn(),
    dispose: vi.fn(),
  };

  return session;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("PiEngine golden path", () => {
  it("emits the expected canonical event sequence for a scripted turn", async () => {
    // --- Arrange -----------------------------------------------------------

    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});
    mockSessionManagerCreate.mockReturnValue(mockSessionManagerInstance);
    mockSessionManagerOpen.mockReturnValue(mockSessionManagerInstance);
    mockModelRegistryFind.mockReturnValue({
      id: "claude-sonnet-4-5",
      provider: "anthropic",
    });

    const fakeSession = createScriptedFakeSession();

    fakeSession.prompt.mockImplementation(async () => {
      await fakeSession.emitScriptedEvents();
    });

    mockCreateAgentSession.mockResolvedValue({
      session: fakeSession,
      modelFallbackMessage: undefined,
    });

    const { PiEngine } = await import("../../src/pi-engine.js");

    const engine = new PiEngine();

    const runtimeConfig = {
      harnessId: "pi" as const,
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        auth: { type: "api_key" as const, apiKey: "test-key" },
      },
      prompt: {
        systemPrompt: "You are a helpful agent.",
        initialPrompt: "Run ls",
      },
      harnessOptions: { stepId: "step-golden" },
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

    // --- Act ---------------------------------------------------------------

    const session = await engine.createSession(runtimeConfig, ctx);

    const capturedEvents: CanonicalSessionEvent[] = [];
    session.subscribe((event) => {
      capturedEvents.push(event);
    });

    await session.prompt("Run ls");

    // --- Assert ------------------------------------------------------------

    expect(capturedEvents).toMatchInlineSnapshot(`
      [
        {
          "stepId": "step-golden",
          "type": "turn_start",
        },
        {
          "args": {
            "command": "ls",
          },
          "stepId": "step-golden",
          "toolCallId": "call-1",
          "toolName": "bash",
          "type": "tool_execution_start",
        },
        {
          "isError": false,
          "result": "file1.txt",
          "stepId": "step-golden",
          "toolCallId": "call-1",
          "toolName": "bash",
          "type": "tool_execution_end",
        },
        {
          "output": {
            "ok": true,
            "response": "Hello",
            "stopReason": "end_turn",
            "usage": undefined,
          },
          "stepId": "step-golden",
          "type": "turn_end",
        },
        {
          "output": {
            "ok": true,
            "response": "Done",
            "stopReason": "end_turn",
          },
          "stepId": "step-golden",
          "type": "agent_end",
        },
      ]
    `);
  });
});
