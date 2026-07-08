import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as hookModule from "@/hooks/useWorkItemCostSummary";
import { BudgetWorkItemsTab } from "./BudgetWorkItemsTab";

describe("BudgetWorkItemsTab", () => {
  it("renders actual, remaining, and projected cost columns", () => {
    vi.spyOn(hookModule, "useWorkItemCostSummary").mockReturnValue({
      data: [
        {
          id: "wi-1",
          project_id: "project-1",
          title: "Fix bug",
          status: "in-progress",
          tokenSpend: 4000,
          costCents: 120,
          predictedRemainingCostCents: 90,
          projectedTotalCostCents: 210,
        },
      ],
      isLoading: false,
    } as never);

    render(<BudgetWorkItemsTab />);

    expect(screen.getByText("Actual So Far")).toBeInTheDocument();
    expect(screen.getByText("Predicted Remaining")).toBeInTheDocument();
    expect(screen.getByText("Projected Total")).toBeInTheDocument();
    expect(screen.getByText("$1.20")).toBeInTheDocument();
    expect(screen.getByText("$0.90")).toBeInTheDocument();
    expect(screen.getByText("$2.10")).toBeInTheDocument();
  });
});
