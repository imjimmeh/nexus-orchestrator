import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryTable } from "./budget-summary-table";
import type { BudgetSummaryRow } from "@/lib/api/client.budget.types";

function buildRow(overrides: Partial<BudgetSummaryRow> = {}): BudgetSummaryRow {
  return {
    key: "deepseek",
    total_cents: "0",
    total_tokens: "0",
    count: "57",
    unpriced_count: "0",
    ...overrides,
  };
}

describe("SummaryTable", () => {
  it("flags rows that contain unpriced events distinctly from a true zero spend", () => {
    render(
      <SummaryTable
        rows={[buildRow({ unpriced_count: "32" })]}
        groupBy="provider"
        onGroupByChange={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByText(/32 unpriced/i)).toBeTruthy();
  });

  it("does not show an unpriced indicator when every event is priced", () => {
    render(
      <SummaryTable
        rows={[buildRow({ unpriced_count: "0", total_cents: "129" })]}
        groupBy="provider"
        onGroupByChange={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.queryByText(/unpriced/i)).toBeNull();
  });
});
