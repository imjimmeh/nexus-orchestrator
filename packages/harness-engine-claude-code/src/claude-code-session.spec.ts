import { describe, it, expect } from "vitest";
import { ClaudeCodeSession } from "./claude-code-session.js";
import { ClaudeEventMapper } from "./map-claude-event.js";
import type { CanonicalSessionEvent } from "@nexus/core";

type AgentEndEvent = CanonicalSessionEvent & {
  output?: { ok?: boolean; stopReason?: string; suspended?: boolean };
};

/**
 * A generator that yields one init message then blocks until `abort()` rejects
 * it — mimics the SDK query being cancelled mid-turn.
 */
function deferredGenerator(): {
  gen: AsyncIterable<unknown>;
  abort: () => void;
} {
  let rejectFn!: (e: unknown) => void;
  const gen = (async function* () {
    yield { type: "system", session_id: "sess-1" };
    await new Promise<void>((_, reject) => {
      rejectFn = reject;
    });
  })();
  return {
    gen,
    abort: () => {
      rejectFn(new Error("AbortError"));
    },
  };
}

describe("ClaudeCodeSession suspend", () => {
  it("emits a suspended agent_end (ok:true) when suspended before the stream errors", async () => {
    const { gen, abort } = deferredGenerator();
    const events: CanonicalSessionEvent[] = [];
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("strategize"),
      "strategize",
    );
    session.subscribe((e) => events.push(e));
    // Let the generator yield its first message.
    await new Promise((r) => setTimeout(r, 0));

    session.suspend();
    abort();
    await new Promise((r) => setTimeout(r, 0));

    const end = events.find((e) => e.type === "agent_end");
    expect(end?.output?.ok).toBe(true);
    expect(end?.output?.stopReason).toBe("suspended");
    expect(end?.output?.suspended).toBe(true);
  });

  it("still emits a failed agent_end when the stream errors without suspend", async () => {
    const { gen, abort } = deferredGenerator();
    const events: CanonicalSessionEvent[] = [];
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("strategize"),
      "strategize",
    );
    session.subscribe((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 0));

    abort();
    await new Promise((r) => setTimeout(r, 0));

    const end = events.find((e) => e.type === "agent_end");
    expect(end?.output?.ok).toBe(false);
    expect(end?.output?.stopReason).toBe("error");
  });
});
