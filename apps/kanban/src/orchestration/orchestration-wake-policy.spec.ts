import { describe, it, expect } from "vitest";
import {
  resolveWakePolicy,
  shouldWakeForTerminalRun,
} from "./orchestration-wake-policy";

describe("resolveWakePolicy", () => {
  it("defaults to slot_freed when nothing is set", () => {
    expect(resolveWakePolicy(undefined, undefined)).toBe("slot_freed");
  });

  it("uses the global setting when no project override", () => {
    expect(resolveWakePolicy(undefined, "every_terminal")).toBe(
      "every_terminal",
    );
  });

  it("prefers the project override over the global setting", () => {
    expect(resolveWakePolicy("slot_freed", "every_terminal")).toBe(
      "slot_freed",
    );
  });

  it("normalizes unknown values to slot_freed", () => {
    expect(resolveWakePolicy("nonsense", 42)).toBe("slot_freed");
    expect(resolveWakePolicy(null, "EVERY_TERMINAL")).toBe("slot_freed");
  });
});

describe("shouldWakeForTerminalRun", () => {
  it("every_terminal always wakes", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "every_terminal",
        workItemRunKind: "completed_work_item",
        itemStillActive: true,
      }),
    ).toEqual({ wake: true });
  });

  it("non-work-item runs always wake regardless of policy", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "other",
        itemStillActive: true,
      }),
    ).toEqual({ wake: true });
  });

  it("slot_freed wakes when the item no longer consumes a slot", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "completed_work_item",
        itemStillActive: false,
      }),
    ).toEqual({ wake: true });
  });

  it("slot_freed suppresses when the item still consumes a slot", () => {
    expect(
      shouldWakeForTerminalRun({
        policy: "slot_freed",
        workItemRunKind: "completed_work_item",
        itemStillActive: true,
      }),
    ).toEqual({ wake: false, suppressReason: "slot_not_freed" });
  });
});
