import { describe, it, expect, vi } from "vitest";
import type { CanonicalSessionEvent } from "@nexus/core";
import { maybeCreateCheckpointWriter } from "./checkpoint-wiring.js";

function fakeSession(producedSessionId?: string) {
  const handlers = new Set<(e: CanonicalSessionEvent) => void>();
  return {
    subscribe: vi.fn((h: (e: CanonicalSessionEvent) => void) => {
      handlers.add(h);
      return () => handlers.delete(h);
    }),
    getProducedSessionId: producedSessionId
      ? () => producedSessionId
      : undefined,
    prompt: async () => {},
    abort: async () => {},
    dispose: async () => {},
  };
}

describe("maybeCreateCheckpointWriter", () => {
  it("returns undefined when SESSION_CHECKPOINT_PATH is not set", () => {
    const session = fakeSession();
    const writer = maybeCreateCheckpointWriter(session, {
      harnessId: "pi",
      checkpointPath: undefined,
    });
    expect(writer).toBeUndefined();
    expect(session.subscribe).not.toHaveBeenCalled();
  });

  it("returns a started writer for the pi engine when path is set", () => {
    const session = fakeSession();
    const writer = maybeCreateCheckpointWriter(session, {
      harnessId: "pi",
      checkpointPath: "/tmp/ckpt.jsonl",
    });
    expect(writer).toBeDefined();
    // subscribe is called by writer.start()
    expect(session.subscribe).toHaveBeenCalledOnce();
    writer!.stop();
  });

  it("returns a started writer for the claude-code engine when path is set", () => {
    const session = fakeSession("sdk-session-abc");
    const writer = maybeCreateCheckpointWriter(session, {
      harnessId: "claude-code",
      checkpointPath: "/tmp/ckpt.jsonl",
    });
    expect(writer).toBeDefined();
    expect(session.subscribe).toHaveBeenCalledOnce();
    writer!.stop();
  });

  it("returns undefined for a custom:* engine even when path is set", () => {
    const session = fakeSession();
    const writer = maybeCreateCheckpointWriter(session, {
      harnessId: "custom:my-engine",
      checkpointPath: "/tmp/ckpt.jsonl",
    });
    expect(writer).toBeUndefined();
    expect(session.subscribe).not.toHaveBeenCalled();
  });
});
