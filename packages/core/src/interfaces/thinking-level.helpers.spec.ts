import { describe, expect, it } from "vitest";
import {
  THINKING_LEVEL_ORDER,
  parseThinkingLevel,
  clampThinkingLevel,
  resolveThinkingLevel,
} from "./thinking-level.helpers";

describe("thinking-level helpers", () => {
  it("orders levels off..xhigh", () => {
    expect(THINKING_LEVEL_ORDER).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  describe("parseThinkingLevel", () => {
    it("accepts valid levels", () => {
      expect(parseThinkingLevel("high")).toBe("high");
    });
    it("rejects invalid / non-string", () => {
      expect(parseThinkingLevel("turbo")).toBeUndefined();
      expect(parseThinkingLevel(3)).toBeUndefined();
      expect(parseThinkingLevel(undefined)).toBeUndefined();
    });
  });

  describe("clampThinkingLevel", () => {
    it("returns the requested level when supported", () => {
      expect(clampThinkingLevel("medium", ["low", "medium", "high"])).toBe(
        "medium",
      );
    });
    it("clamps down to the nearest supported", () => {
      expect(clampThinkingLevel("xhigh", ["low", "medium"])).toBe("medium");
    });
    it("clamps up when request is below all supported", () => {
      expect(clampThinkingLevel("minimal", ["high", "xhigh"])).toBe("high");
    });
    it("breaks ties downward", () => {
      // 'low'(2) is equidistant from 'minimal'(1) and 'medium'(3) -> pick lower
      expect(clampThinkingLevel("low", ["minimal", "medium"])).toBe("minimal");
    });
    it("returns undefined when nothing is supported", () => {
      expect(clampThinkingLevel("high", [])).toBeUndefined();
    });
    it("returns undefined when only 'off' is supported for a non-off request", () => {
      expect(clampThinkingLevel("high", ["off"])).toBeUndefined();
    });
    it("always honors an explicit 'off' request", () => {
      expect(clampThinkingLevel("off", ["high", "xhigh"])).toBe("off");
      expect(clampThinkingLevel("off", [])).toBe("off");
    });
  });

  describe("resolveThinkingLevel", () => {
    it("prefers step input over profile over model default", () => {
      expect(
        resolveThinkingLevel({
          stepInput: "high",
          agentProfile: "low",
          modelDefault: "off",
        }),
      ).toBe("high");
    });
    it("falls through to profile then model default", () => {
      expect(
        resolveThinkingLevel({ agentProfile: "low", modelDefault: "off" }),
      ).toBe("low");
      expect(resolveThinkingLevel({ modelDefault: "medium" })).toBe("medium");
    });
    it("returns undefined when nothing is configured", () => {
      expect(resolveThinkingLevel({})).toBeUndefined();
    });
  });
});
