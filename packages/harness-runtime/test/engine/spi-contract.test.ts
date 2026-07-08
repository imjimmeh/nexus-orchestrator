// packages/harness-runtime/test/engine/spi-contract.test.ts
import { describe, it, expect } from "vitest";
import type {
  HarnessEngine,
  HarnessSession,
} from "../../src/engine/harness-engine.js";
import type { CanonicalSessionEvent, HarnessCapabilities } from "@nexus/core";
import { PI_CAPABILITIES } from "@nexus/core";
import { applyContributions } from "../../src/engine/apply-contributions.js";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "../../src/engine/contribution-materializers.js";

class FakeSession implements HarnessSession {
  private handler?: (e: CanonicalSessionEvent) => void;
  async prompt() {
    this.handler?.({ type: "turn_start", stepId: "s" });
  }
  async abort() {}
  subscribe(h: (e: CanonicalSessionEvent) => void) {
    this.handler = h;
    return () => {};
  }
  async dispose() {}
}

const fakeEngine: HarnessEngine = {
  id: "pi",
  capabilities: PI_CAPABILITIES,
  validate: () => ({ ok: true }),
  createSession: async () => new FakeSession(),
};

describe("HarnessEngine SPI", () => {
  it("creates a session that emits canonical events on prompt", async () => {
    const session = await fakeEngine.createSession({}, {} as never);
    const events: CanonicalSessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.prompt("hi");
    expect(events[0]).toEqual({ type: "turn_start", stepId: "s" });
  });
});

const baseCapabilities: HarnessCapabilities = {
  executionModes: ["agent_turn"],
  toolModel: "permission_callback",
  supportsSubagents: false,
  supportsWarRoom: false,
  supportsBranching: false,
  supportsResume: false,
  resumeMechanism: "file_injection",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key"],
  telemetryContractVersion: "v1",
};

describe("applyContributions SPI contract", () => {
  it("is a no-op for an engine that declares no contribution capabilities", async () => {
    const ctx = {
      governedTools: [],
      toolCatalog: [],
      checkPermission: async () => ({ status: "allowed" as const }),
      workspacePath: "/w",
      agentDir: "/a",
      extensionsPath: "/e",
      sessionPath: "/s",
      contributions: {
        hooks: [{ event: "session_start" as const, command: "x" }],
        extensions: [],
        settings: {},
      },
    };
    // fakeEngine has PI_CAPABILITIES with supportsHooks:false — must not throw
    await expect(applyContributions(fakeEngine, ctx)).resolves.toBeUndefined();
  });
});

describe("materializer type-guard conformance", () => {
  it("is*Materializer returns true when capability is declared AND method is implemented", () => {
    const syntheticEngine = {
      id: "synthetic",
      capabilities: {
        ...baseCapabilities,
        supportsHooks: true,
        supportedHookEvents: ["session_start" as const],
        supportsExtensions: true,
        supportsSettings: true,
      },
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeHooks: async () => {},
      materializeExtensions: async () => {},
      materializeSettings: async () => {},
    } as unknown as HarnessEngine;

    expect(isHookMaterializer(syntheticEngine)).toBe(true);
    expect(isExtensionMaterializer(syntheticEngine)).toBe(true);
    expect(isSettingsMaterializer(syntheticEngine)).toBe(true);
  });

  it("is*Materializer returns false when capability is declared true but method is absent (drift case)", () => {
    const driftEngine = {
      id: "drift",
      capabilities: {
        ...baseCapabilities,
        supportsHooks: true,
        supportedHookEvents: ["session_start" as const],
        supportsExtensions: true,
        supportsSettings: true,
      },
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      // Deliberately omits materializeHooks / materializeExtensions / materializeSettings
    } as unknown as HarnessEngine;

    expect(isHookMaterializer(driftEngine)).toBe(false);
    expect(isExtensionMaterializer(driftEngine)).toBe(false);
    expect(isSettingsMaterializer(driftEngine)).toBe(false);
  });
});
