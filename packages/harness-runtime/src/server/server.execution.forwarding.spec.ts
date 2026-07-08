import { describe, it, expect, vi } from "vitest";
import type { CanonicalSessionEvent } from "@nexus/core";
import { executeAgentStep } from "./server.execution.js";

/**
 * Builds a fake engine + session + orchestrator client where prompting the
 * session synchronously emits one agent_telemetry event followed by agent_end
 * (so the foreground run resolves). The captured `client.emit` calls let tests
 * assert how canonical events are translated onto the wire.
 */
function createForwardingHarness(telemetry: CanonicalSessionEvent) {
  let handler: ((e: CanonicalSessionEvent) => void) | null = null;
  const session = {
    subscribe: vi.fn((h: (e: CanonicalSessionEvent) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    }),
    prompt: vi.fn(async () => {
      handler?.(telemetry);
      handler?.({
        type: "agent_end",
        stepId: "step-1",
        output: { ok: true, response: "done", stopReason: "end_turn" },
      });
    }),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
  const engine = { createSession: vi.fn(async () => session) };
  const client = { emit: vi.fn() };
  return { session, engine, client };
}

const REQUEST = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  auth: { type: "api_key", apiKey: "test-key" },
  stepId: "step-1",
  systemPrompt: "You are a test agent.",
};

describe("executeAgentStep — agent_telemetry forwarding", () => {
  it("promotes telemetryType to the wire payload `type` so the session view can read it", async () => {
    const { engine, client } = createForwardingHarness({
      type: "agent_telemetry",
      stepId: "step-1",
      telemetryType: "thinking_end",
      content: "deliberating",
    });

    await executeAgentStep(
      { harnessId: "pi", sessionId: "sess-1" } as never,
      client as never,
      engine as never,
      {} as never,
      REQUEST as never,
    );

    const telemetryCall = client.emit.mock.calls.find(
      ([event]) => event === "agent_telemetry",
    );
    expect(telemetryCall).toBeDefined();
    const payload = telemetryCall![1] as Record<string, unknown>;
    expect(payload.type).toBe("thinking_end");
    expect(payload.content).toBe("deliberating");
    // telemetryType is collapsed into `type` on the wire — not duplicated.
    expect(payload.telemetryType).toBeUndefined();
  });
});
