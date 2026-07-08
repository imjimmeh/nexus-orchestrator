import { describe, expect, it } from "vitest";
import {
  isStoppedLifecycleStatus,
  resolveNonAutoWakeDecision,
} from "./orchestration-stop-decisions";

describe("resolveNonAutoWakeDecision", () => {
  it.each([
    {
      name: "cycleDecision",
      stopEntry: { type: "cycle_decision", cycleDecision: "blocked" },
      expected: "blocked",
    },
    {
      name: "legacy decision",
      stopEntry: { type: "cycle_decision", decision: "pause" },
      expected: "pause",
    },
    {
      name: "actions[0]",
      stopEntry: { type: "cycle_decision", actions: ["complete"] },
      expected: "complete",
    },
  ])(
    "ignores unrelated entries after a stop decision from $name",
    ({ stopEntry, expected }) => {
      const decision = resolveNonAutoWakeDecision({
        metadata: {},
        decision_log: [
          stopEntry,
          {
            type: "action_request",
            actions: ["dispatch_start_work_items"],
          },
        ],
      });

      expect(decision).toBe(expected);
    },
  );

  it("stops suppressing wakeups after an explicit cycle decision clear", () => {
    const decision = resolveNonAutoWakeDecision({
      metadata: {},
      decision_log: [
        { type: "cycle_decision", cycleDecision: "blocked" },
        {
          type: "cycle_decision_cleared",
          actions: ["clear_cycle_decision"],
        },
      ],
    });

    expect(decision).toBeUndefined();
  });
});

describe("isStoppedLifecycleStatus", () => {
  it.each(["completed", "paused"])(
    "treats %s as a stopped lifecycle status",
    (status) => {
      expect(isStoppedLifecycleStatus(status)).toBe(true);
    },
  );

  it.each(["orchestrating", "initializing", ""])(
    "treats %s as an active lifecycle status",
    (status) => {
      expect(isStoppedLifecycleStatus(status)).toBe(false);
    },
  );
});
