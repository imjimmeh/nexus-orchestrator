import { describe, it, expect } from "vitest";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
  type HookMaterializer,
} from "../../src/engine/contribution-materializers.js";

describe("materializer type guards", () => {
  it("detects a hook materializer", () => {
    const e: HookMaterializer = { async materializeHooks() {} };
    expect(isHookMaterializer(e)).toBe(true);
    expect(isExtensionMaterializer(e)).toBe(false);
    expect(isSettingsMaterializer(e)).toBe(false);
  });

  it("returns false for a plain object", () => {
    expect(isHookMaterializer({})).toBe(false);
  });
});
