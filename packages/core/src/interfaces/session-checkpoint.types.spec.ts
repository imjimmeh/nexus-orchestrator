import { describe, it, expect } from "vitest";
import {
  SESSION_CHECKPOINT_PHASES,
  isSessionCheckpointMarker,
  type SessionCheckpointMarker,
} from "./session-checkpoint.types.js";

describe("session-checkpoint contract", () => {
  it("exposes intent and result phases", () => {
    expect(SESSION_CHECKPOINT_PHASES).toEqual(["intent", "result"]);
  });

  it("accepts a well-formed marker", () => {
    const marker: SessionCheckpointMarker = {
      engine: "pi",
      sessionRef: { kind: "pi", treeId: "t1", resumeNodeId: "n9" },
      resumeNodeId: "n9",
      phase: "intent",
      callSeq: 3,
      toolName: "project.create_resource",
      idempotencyKey: "abc123",
    };
    expect(isSessionCheckpointMarker(marker)).toBe(true);
  });

  it("rejects an unknown phase", () => {
    expect(
      isSessionCheckpointMarker({ engine: "pi", phase: "bogus", callSeq: 1 }),
    ).toBe(false);
  });

  it("rejects null", () => {
    expect(isSessionCheckpointMarker(null)).toBe(false);
  });

  it("rejects a missing engine", () => {
    expect(isSessionCheckpointMarker({ phase: "intent", callSeq: 0 })).toBe(
      false,
    );
  });

  it("rejects a non-number callSeq", () => {
    expect(
      isSessionCheckpointMarker({
        engine: "pi",
        phase: "intent",
        callSeq: "0",
      }),
    ).toBe(false);
  });

  describe("isSessionCheckpointMarker with HarnessId engine", () => {
    it("accepts pi engine", () => {
      expect(
        isSessionCheckpointMarker({
          engine: "pi",
          phase: "intent",
          callSeq: 1,
        }),
      ).toBe(true);
    });

    it("accepts claude-code engine (HarnessId hyphen form)", () => {
      expect(
        isSessionCheckpointMarker({
          engine: "claude-code",
          phase: "intent",
          callSeq: 1,
        }),
      ).toBe(true);
    });

    it("accepts custom harness engine", () => {
      expect(
        isSessionCheckpointMarker({
          engine: "custom:my-harness",
          phase: "intent",
          callSeq: 1,
        }),
      ).toBe(true);
    });

    it("rejects legacy underscore form", () => {
      expect(
        isSessionCheckpointMarker({
          engine: "claude_code",
          phase: "intent",
          callSeq: 1,
        }),
      ).toBe(false);
    });

    it("rejects unknown engine", () => {
      expect(
        isSessionCheckpointMarker({
          engine: "unknown",
          phase: "intent",
          callSeq: 1,
        }),
      ).toBe(false);
    });
  });
});
