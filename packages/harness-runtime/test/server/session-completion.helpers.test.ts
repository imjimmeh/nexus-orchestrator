import { describe, it, expect } from "vitest";
import {
  extractTurnError,
  reconcileAgentEnd,
  reconcileAgentEndEvent,
} from "../../src/server/session-completion.helpers.js";

describe("extractTurnError", () => {
  it("returns the error message for a failed turn", () => {
    expect(
      extractTurnError({ ok: false, errorMessage: "402 Insufficient Balance" }),
    ).toBe("402 Insufficient Balance");
  });

  it("treats ok:false without a message as a generic turn failure", () => {
    expect(extractTurnError({ ok: false })).toBe("agent turn failed");
  });

  it("returns undefined for a successful turn", () => {
    expect(extractTurnError({ ok: true, response: "done" })).toBeUndefined();
  });
});

describe("reconcileAgentEnd", () => {
  it("forces failure when the last turn errored but agent_end masks it as ok:true", () => {
    const result = reconcileAgentEnd({
      agentOutput: { ok: true, response: "", stopReason: "end_turn" },
      lastTurnError: "400 You're out of extra usage",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("out of extra usage");
  });

  it("keeps success when no turn failed", () => {
    const result = reconcileAgentEnd({
      agentOutput: { ok: true, response: "answer", stopReason: "end_turn" },
      lastTurnError: undefined,
    });

    expect(result).toEqual({ ok: true, response: "answer" });
  });

  it("preserves an already-failed agent_end and its message", () => {
    const result = reconcileAgentEnd({
      agentOutput: { ok: false, response: "", errorMessage: "boom" },
      lastTurnError: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("defaults ok to true when agent_end omits it and no turn failed", () => {
    expect(
      reconcileAgentEnd({ agentOutput: {}, lastTurnError: undefined }),
    ).toEqual({
      ok: true,
      response: "",
    });
  });
});

describe("reconcileAgentEndEvent", () => {
  it("rewrites a masked agent_end event to ok:false / error and returns a failed completion", () => {
    const event = {
      type: "agent_end" as const,
      stepId: "strategize",
      output: { ok: true, response: "", stopReason: "end_turn" },
    };

    const { forward, completion } = reconcileAgentEndEvent(
      event,
      "400 out of extra usage",
    );

    expect(completion.ok).toBe(false);
    expect(forward.output).toMatchObject({
      ok: false,
      stopReason: "error",
      errorMessage: "400 out of extra usage",
    });
  });

  it("forwards the original event unchanged on success", () => {
    const event = {
      type: "agent_end" as const,
      stepId: "s",
      output: { ok: true, response: "done", stopReason: "end_turn" },
    };

    const { forward, completion } = reconcileAgentEndEvent(event, undefined);

    expect(completion).toEqual({ ok: true, response: "done" });
    expect(forward).toBe(event);
  });
});
