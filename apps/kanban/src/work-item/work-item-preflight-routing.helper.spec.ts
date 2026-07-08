import { describe, expect, it } from "vitest";
import {
  readRefinementRoutingMeta,
  resolvePromotionReroute,
  shouldGateDispatchToRefinement,
} from "./work-item-preflight-routing.helper";

describe("readRefinementRoutingMeta", () => {
  it("returns all-false defaults for null/undefined/garbage metadata", () => {
    for (const input of [null, undefined, 42, "x", {}]) {
      expect(readRefinementRoutingMeta(input)).toEqual({
        hasClearedRefinementOnce: false,
        retroactiveRefinementRequired: false,
        isSplitChild: false,
      });
    }
  });

  it("reads nested refinement + split flags", () => {
    const meta = {
      refinement: {
        hasClearedRefinementOnce: true,
        retroactiveRefinementRequired: true,
      },
      split: { parentId: "parent-1" },
    };
    expect(readRefinementRoutingMeta(meta)).toEqual({
      hasClearedRefinementOnce: true,
      retroactiveRefinementRequired: true,
      isSplitChild: true,
    });
  });
});

describe("resolvePromotionReroute", () => {
  const base = {
    currentStatus: "backlog" as const,
    requestedStatus: "todo" as const,
    hasClearedRefinementOnce: false,
    preflightEnabled: true,
  };

  it("reroutes a genuine backlog→todo promotion to refinement when enabled and not yet cleared", () => {
    expect(resolvePromotionReroute(base)).toEqual({
      effectiveStatus: "refinement",
      rerouted: true,
      reason: "promotion_preflight",
    });
  });

  it("passes through when preflight disabled", () => {
    expect(
      resolvePromotionReroute({ ...base, preflightEnabled: false }),
    ).toEqual({
      effectiveStatus: "todo",
      rerouted: false,
      reason: null,
    });
  });

  it("passes through when the item already cleared refinement", () => {
    expect(
      resolvePromotionReroute({ ...base, hasClearedRefinementOnce: true }),
    ).toEqual({
      effectiveStatus: "todo",
      rerouted: false,
      reason: null,
    });
  });

  it("passes through when not a backlog→todo promotion (e.g. recovery in-progress→todo)", () => {
    expect(
      resolvePromotionReroute({ ...base, currentStatus: "in-progress" }),
    ).toEqual({ effectiveStatus: "todo", rerouted: false, reason: null });
  });

  it("passes through when requested target is not todo", () => {
    expect(
      resolvePromotionReroute({ ...base, requestedStatus: "blocked" }),
    ).toEqual({ effectiveStatus: "blocked", rerouted: false, reason: null });
  });
});

describe("shouldGateDispatchToRefinement", () => {
  it("gates a never-refined todo item when required", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: false,
        preflightRequired: true,
      }),
    ).toBe(true);
  });

  it("does not gate when not required", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: false,
        preflightRequired: false,
      }),
    ).toBe(false);
  });

  it("does not gate an already-refined item", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: true,
        preflightRequired: true,
      }),
    ).toBe(false);
  });
});
