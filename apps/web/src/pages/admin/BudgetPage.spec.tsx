import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { BudgetPage } from "./BudgetPage";

vi.mock("@/components/budget/BudgetSpendTab", () => ({
  BudgetSpendTab: () => <div>spend-tab-body</div>,
}));

vi.mock("@/components/budget/BudgetPoliciesTab", () => ({
  BudgetPoliciesTab: () => <div>policies-tab-body</div>,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopeProvider>
          <BudgetPage />
        </ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BudgetPage", () => {
  it("exposes both Spend and Policies tabs", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Spend" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Policies" })).toBeTruthy();
  });

  it("selects the Spend tab by default", () => {
    renderPage();

    expect(
      screen.getByRole("tab", { name: "Spend" }).getAttribute("data-state"),
    ).toBe("active");
    expect(screen.getByText("spend-tab-body")).toBeTruthy();
    expect(screen.queryByText("policies-tab-body")).toBeNull();
  });
});
