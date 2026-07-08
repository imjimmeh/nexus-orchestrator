/**
 * Regression guard: PI engine session resume behaviour.
 *
 * Verifies that when the engine is given a session path that already exists on
 * disk (the resume case) it calls `SessionManager.open(path, agentDir)` to
 * continue the existing session, rather than `SessionManager.create(...)` which
 * would start fresh. When an optional `resumeNodeId` is also provided the
 * engine must branch to that node via `sm.branch(nodeId)`.
 *
 * This test does NOT spin a real Docker container; it mocks the pi-coding-agent
 * SDK at the module level (same approach as pi-engine.provider-auth.test.ts).
 * Full container-level reap→resume fidelity is covered by the Phase 6
 * deterministic E2E (Task 17).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fsModule from "node:fs";

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
const mockBranch = vi.fn();
const mockGetLeafEntry = vi.fn();

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
  existsSync: vi.fn(),
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
    initialPrompt: "Continue from where we left off.",
  },
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

describe("PiEngine — session resume", () => {
  let engine: Awaited<ReturnType<typeof import("./pi-engine.js")>>["PiEngine"];

  beforeEach(async () => {
    vi.clearAllMocks();

    mockAuthStorageInMemory.mockReturnValue(mockAuthInstance);
    mockSettingsManagerInMemory.mockReturnValue({});

    const mockSmInstance = {
      branch: mockBranch,
      getLeafEntry: mockGetLeafEntry,
    };
    mockGetLeafEntry.mockReturnValue(undefined);
    mockSessionManagerOpen.mockReturnValue(mockSmInstance);
    mockSessionManagerCreate.mockReturnValue(mockSmInstance);

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

  it("opens existing session via SessionManager.open when sessionPath exists on disk", async () => {
    // Arrange: session file exists on disk
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockSessionManagerOpen).toHaveBeenCalledWith(
      BASE_CTX.sessionPath,
      BASE_CTX.agentDir,
    );
    expect(mockSessionManagerCreate).not.toHaveBeenCalled();
  });

  it("creates a fresh session via SessionManager.create when sessionPath does not exist", async () => {
    // Arrange: no session file on disk
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockSessionManagerCreate).toHaveBeenCalledWith(
      BASE_CTX.workspacePath,
      BASE_CTX.agentDir,
    );
    expect(mockSessionManagerOpen).not.toHaveBeenCalled();
  });

  it("branches to resumeNodeId when sessionPath exists and resumeNodeId is provided", async () => {
    // Arrange: session file exists + config carries a resume node
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    const instance = new engine();
    const configWithResume = {
      ...BASE_RUNTIME_CONFIG,
      session: { resumeNodeId: "node-42" },
    };

    await instance.createSession(configWithResume, BASE_CTX);

    expect(mockSessionManagerOpen).toHaveBeenCalled();
    expect(mockBranch).toHaveBeenCalledWith("node-42");
  });

  it("does not call branch when sessionPath exists but no resumeNodeId is given", async () => {
    // Arrange: session file exists, no resume node
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockSessionManagerOpen).toHaveBeenCalled();
    expect(mockBranch).not.toHaveBeenCalled();
  });

  it("branches past a trailing aborted assistant leaf so resume can continue", async () => {
    // Regression: a durable-await suspend aborts the in-flight pi turn, which
    // the pi SDK persists as a final AssistantMessage (stopReason "aborted").
    // On resume, pi-agent-core's agentLoopContinue throws "Cannot continue from
    // message role: assistant" because the loaded context ends on an assistant
    // turn. The engine must branch to the aborted turn's parent (the last
    // tool_result / user entry) so continue resumes from a valid point.
    // See kanban-1fbn.
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    mockGetLeafEntry.mockReturnValue({
      type: "message",
      id: "aborted-assistant",
      parentId: "await-tool-result",
      message: { role: "assistant", stopReason: "aborted", content: [] },
    });

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockBranch).toHaveBeenCalledWith("await-tool-result");
  });

  it("does not branch when the trailing leaf is a completed (non-assistant) turn", async () => {
    // A clean resume whose tail is a tool_result / user turn must be left
    // untouched — branching there would discard valid context.
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    mockGetLeafEntry.mockReturnValue({
      type: "message",
      id: "tool-result",
      parentId: "assistant-1",
      message: { role: "user", content: [{ type: "text", text: "result" }] },
    });

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockBranch).not.toHaveBeenCalled();
  });

  it("branches past a trailing completed (end_turn) assistant leaf so resume can continue", async () => {
    // A resume can also be triggered after a job has already completed a turn
    // (e.g. a spurious re-dispatch). The session leaf is then a *completed*
    // assistant turn (stopReason "end_turn"), which pi-agent-core's
    // agentLoopContinue still refuses ("Cannot continue from message role:
    // assistant"). The engine must branch back to the last tool_result / user
    // entry so resume continues from a valid point instead of crash-looping.
    // See kanban-1fbn follow-up (runs 0de65a08 / f0b9b05b).
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    mockGetLeafEntry.mockReturnValue({
      type: "message",
      id: "completed-assistant",
      parentId: "last-tool-result",
      message: {
        role: "assistant",
        stopReason: "end_turn",
        content: [{ type: "text", text: "Investigation complete." }],
      },
    });

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockBranch).toHaveBeenCalledWith("last-tool-result");
  });

  it("branches past a trailing tool-call (toolUse) assistant leaf so resume can continue", async () => {
    // A session whose persisted leaf is an assistant turn that requested tools
    // (stopReason "toolUse") but whose tool results were never written back is
    // equally unresumable — agentLoopContinue throws on the assistant leaf. The
    // only available recovery is to branch back to the parent so the model is
    // re-prompted from the last valid turn. See kanban-1fbn follow-up.
    vi.mocked(fsModule.existsSync).mockImplementation((p) =>
      String(p).endsWith("session.jsonl"),
    );

    mockGetLeafEntry.mockReturnValue({
      type: "message",
      id: "tooluse-assistant",
      parentId: "prior-tool-result",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Updating the todo list." },
          { type: "toolCall", name: "manage_todo_list" },
        ],
      },
    });

    const instance = new engine();
    await instance.createSession(BASE_RUNTIME_CONFIG, BASE_CTX);

    expect(mockBranch).toHaveBeenCalledWith("prior-tool-result");
  });
});
