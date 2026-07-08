import { describe, expect, it } from "vitest";
import {
  getContentOffsetClass,
  getEffectiveNavExpanded,
} from "./layout-offset";

describe("getEffectiveNavExpanded", () => {
  it("is true only when expanded and panel closed", () => {
    expect(getEffectiveNavExpanded(true, false)).toBe(true);
    expect(getEffectiveNavExpanded(true, true)).toBe(false);
    expect(getEffectiveNavExpanded(false, false)).toBe(false);
    expect(getEffectiveNavExpanded(false, true)).toBe(false);
  });
});

describe("getContentOffsetClass", () => {
  it("returns the panel offset when the scope panel is open", () => {
    expect(getContentOffsetClass(true, true)).toBe("pl-0 md:pl-[288px]");
    expect(getContentOffsetClass(false, true)).toBe("pl-0 md:pl-[288px]");
  });

  it("returns the wide offset when expanded and panel closed", () => {
    expect(getContentOffsetClass(true, false)).toBe("pl-0 md:pl-64");
  });

  it("returns the rail offset when collapsed and panel closed", () => {
    expect(getContentOffsetClass(false, false)).toBe("pl-0 md:pl-12");
  });
});
