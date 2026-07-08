import { describe, it, expect } from "vitest";
import { resolveSessionContributions } from "../../src/kernel.js";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";

describe("resolveSessionContributions", () => {
  it("returns the config bundle when present", () => {
    const bundle = {
      hooks: [],
      extensions: [],
      settings: { outputStyle: "concise" },
    };
    expect(
      resolveSessionContributions({ contributions: bundle }),
    ).toBe(bundle);
  });

  it("falls back to the empty bundle when absent", () => {
    expect(resolveSessionContributions({})).toEqual(
      EMPTY_HARNESS_CONTRIBUTIONS,
    );
  });
});
