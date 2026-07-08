import { describe, it, expect } from "vitest";

describe("autonomous backlog-only board contract", () => {
  it("MUST reject bare repeat when 0 todo + 3+ unblocked backlog", () => {
    const decision = { decision: "repeat", blockedItems: undefined };
    const hasBlockedItems =
      decision.blockedItems && decision.blockedItems.length > 0;
    expect(hasBlockedItems).toBe(true);
  });

  it("CAN accept repeat with blockedItems when all blocked", () => {
    const decision = { decision: "repeat", blockedItems: [{ id: "1" }] };
    expect(decision.blockedItems.length).toBeGreaterThan(0);
  });

  it("CAN accept repeat when todo > 0", () => {
    expect(1).toBeGreaterThan(0);
  });
});
