import { describe, it, expect } from "vitest";
import {
  reconcileAgentEnd,
  reconcileAgentEndEvent,
} from "./session-completion.helpers.js";

describe("reconcileAgentEnd — suspended turn", () => {
  it("propagates suspended onto a successful completion", () => {
    const completion = reconcileAgentEnd({
      agentOutput: {
        ok: true,
        response: "parked",
        stopReason: "suspended",
        suspended: true,
      },
      lastTurnError: undefined,
    });
    expect(completion.ok).toBe(true);
    expect(completion.suspended).toBe(true);
  });

  it("leaves suspended unset for an ordinary success", () => {
    const completion = reconcileAgentEnd({
      agentOutput: { ok: true, response: "done", stopReason: "end_turn" },
      lastTurnError: undefined,
    });
    expect(completion.ok).toBe(true);
    expect(completion.suspended ?? false).toBe(false);
  });

  it("does not mark a suspended event as a failure to forward", () => {
    const { forward, completion } = reconcileAgentEndEvent(
      {
        type: "agent_end",
        output: {
          ok: true,
          response: "parked",
          stopReason: "suspended",
          suspended: true,
        },
      },
      undefined,
    );
    expect(completion.ok).toBe(true);
    expect(completion.suspended).toBe(true);
    expect((forward.output as { stopReason?: string }).stopReason).toBe(
      "suspended",
    );
  });
});
