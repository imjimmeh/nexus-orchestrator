import { describe, it, expect } from "vitest";
import { BUCKET_TIERS, computeTokenDistribution } from "./bucket-tiers";

describe("BUCKET_TIERS", () => {
  it("orders tiers from most to least specific, ending in global", () => {
    expect(BUCKET_TIERS.map((tier) => tier.name)).toEqual([
      "workflow_type_points",
      "workflow_type",
      "global",
    ]);
  });

  it("each tier declares its own minimum sample size", () => {
    for (const tier of BUCKET_TIERS) {
      expect(tier.minSampleSize).toBeGreaterThan(0);
    }
  });
});

describe("computeTokenDistribution", () => {
  it("computes n, mean, p25, p75 over a sample of token counts", () => {
    const result = computeTokenDistribution([100, 200, 300, 400, 500]);

    expect(result.n).toBe(5);
    expect(result.mean).toBe(300);
    expect(result.p25).toBe(200);
    expect(result.p75).toBe(400);
  });

  it("returns n=0 and zeroed stats for an empty sample", () => {
    expect(computeTokenDistribution([])).toEqual({
      n: 0,
      mean: 0,
      p25: 0,
      p75: 0,
    });
  });
});
