import { describe, it, expect, vi } from "vitest";
import { applyContributions } from "../../src/engine/apply-contributions.js";
import type { HarnessEngine } from "../../src/engine/harness-engine.js";
import type { HarnessSessionContext } from "../../src/engine/session-context.js";
import type { HarnessCapabilities } from "@nexus/core";

const baseCtx = (
  overrides: Partial<HarnessSessionContext> = {},
): HarnessSessionContext => ({
  governedTools: [],
  toolCatalog: [],
  checkPermission: async () => ({ status: "allowed" }),
  workspacePath: "/w",
  agentDir: "/a",
  extensionsPath: "/e",
  sessionPath: "/s",
  contributions: { hooks: [], extensions: [], settings: {} },
  ...overrides,
});

const caps = (o: Partial<HarnessCapabilities>): HarnessCapabilities => ({
  executionModes: ["agent_turn"],
  toolModel: "execute_wrapped",
  supportsSubagents: false,
  supportsWarRoom: false,
  supportsBranching: false,
  supportsResume: false,
  resumeMechanism: "file_injection",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key"],
  telemetryContractVersion: "v1",
  ...o,
});

describe("applyContributions", () => {
  it("calls materializeHooks when supported, implemented, and hooks present", async () => {
    const materializeHooks = vi.fn(async () => {});
    const engine = {
      id: "pi",
      capabilities: caps({
        supportsHooks: true,
        supportedHookEvents: ["session_start"],
      }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeHooks,
    } as unknown as HarnessEngine;
    const ctx = baseCtx({
      contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
        extensions: [],
        settings: {},
      },
    });
    await applyContributions(engine, ctx);
    expect(materializeHooks).toHaveBeenCalledOnce();
  });

  it("no-ops when the capability flag is false even if implemented", async () => {
    const materializeHooks = vi.fn(async () => {});
    const engine = {
      id: "pi",
      capabilities: caps({ supportsHooks: false }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeHooks,
    } as unknown as HarnessEngine;
    const ctx = baseCtx({
      contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
        extensions: [],
        settings: {},
      },
    });
    await applyContributions(engine, ctx);
    expect(materializeHooks).not.toHaveBeenCalled();
  });

  it("no-ops when no contributions are present", async () => {
    const materializeSettings = vi.fn(async () => {});
    const engine = {
      id: "claude-code",
      capabilities: caps({ supportsSettings: true }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeSettings,
    } as unknown as HarnessEngine;
    await applyContributions(engine, baseCtx());
    expect(materializeSettings).not.toHaveBeenCalled();
  });
});
