import { describe, expect, it } from "vitest";
import { BUDGET_CHART_PALETTE, getCategoryColor } from "./budget-chart-colors";

describe("getCategoryColor", () => {
  it("returns palette colours in order for the first N items", () => {
    expect(getCategoryColor("a", 0)).toBe(BUDGET_CHART_PALETTE[0]);
    expect(getCategoryColor("b", 1)).toBe(BUDGET_CHART_PALETTE[1]);
    expect(getCategoryColor("c", BUDGET_CHART_PALETTE.length - 1)).toBe(
      BUDGET_CHART_PALETTE[BUDGET_CHART_PALETTE.length - 1],
    );
  });

  it("returns a deterministic HSL colour for indices beyond the palette", () => {
    const color = getCategoryColor("openai", BUDGET_CHART_PALETTE.length);
    expect(color).toMatch(/^hsl\(\d+ \d+\.?\d*% \d+\.?\d*%\)$/);
    expect(color).toBe(getCategoryColor("openai", BUDGET_CHART_PALETTE.length));
  });
});
