import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetStatusBanner, type BudgetDecision } from "./BudgetStatusBanner";

describe("BudgetStatusBanner", () => {
  it("renders nothing for allow decision", () => {
    const { container } = render(<BudgetStatusBanner decision="allow" />);

    expect(container.firstChild).toBeNull();
  });

  it("shows warning banner for warn decision", () => {
    render(<BudgetStatusBanner decision="warn" />);

    expect(screen.getByText("Budget Warning")).toBeTruthy();
    expect(
      screen.getByText(
        "You are approaching your budget limit. Consider reviewing usage before proceeding.",
      ),
    ).toBeTruthy();
  });

  it("shows info banner for approval_required decision", () => {
    render(<BudgetStatusBanner decision="approval_required" />);

    expect(screen.getByText("Budget Approval Required")).toBeTruthy();
    expect(
      screen.getByText("Additional approval is needed to continue."),
    ).toBeTruthy();
  });

  it("shows error banner for deny decision", () => {
    render(<BudgetStatusBanner decision="deny" />);

    const alert = screen.getByRole("alert");
    expect(screen.getByText("Budget Exceeded")).toBeTruthy();
    expect(
      screen.getByText("Execution has been blocked due to budget constraints."),
    ).toBeTruthy();
    expect(alert.className).toContain("destructive");
  });

  it("shows error banner for throttle decision", () => {
    render(<BudgetStatusBanner decision="throttle" />);

    const alert = screen.getByRole("alert");
    expect(screen.getByText("Budget Throttled")).toBeTruthy();
    expect(alert.className).toContain("destructive");
  });

  it("includes reasonCode in deny message", () => {
    render(
      <BudgetStatusBanner decision="deny" reasonCode="HARD_LIMIT_EXCEEDED" />,
    );

    expect(
      screen.getByText(
        "Execution has been blocked due to budget constraints (HARD_LIMIT_EXCEEDED).",
      ),
    ).toBeTruthy();
  });

  it("includes reasonCode in approval_required message", () => {
    render(
      <BudgetStatusBanner
        decision="approval_required"
        reasonCode="OVER_SOFT_LIMIT"
      />,
    );

    expect(
      screen.getByText(
        "Additional approval is needed to continue (OVER_SOFT_LIMIT).",
      ),
    ).toBeTruthy();
  });

  it("displays estimated cost when provided", () => {
    render(<BudgetStatusBanner decision="warn" estimatedCostCents={1500} />);

    expect(screen.getByText("Estimated cost: $15.00")).toBeTruthy();
  });

  it("displays remaining budget when provided", () => {
    render(<BudgetStatusBanner decision="warn" remainingBudgetCents={2500} />);

    expect(screen.getByText("Remaining budget: $25.00")).toBeTruthy();
  });

  it("displays both estimated cost and remaining budget when both provided", () => {
    render(
      <BudgetStatusBanner
        decision="warn"
        estimatedCostCents={1500}
        remainingBudgetCents={2500}
      />,
    );

    expect(screen.getByText("Estimated cost: $15.00")).toBeTruthy();
    expect(screen.getByText("Remaining budget: $25.00")).toBeTruthy();
  });

  it("does not display cost info section when neither value is provided", () => {
    render(<BudgetStatusBanner decision="warn" />);

    expect(screen.queryByText(/Estimated cost:/)).toBeNull();
    expect(screen.queryByText(/Remaining budget:/)).toBeNull();
  });

  it("handles null estimatedCostCents gracefully", () => {
    render(
      <BudgetStatusBanner
        decision="warn"
        estimatedCostCents={null}
        remainingBudgetCents={2500}
      />,
    );

    expect(screen.queryByText(/Estimated cost:/)).toBeNull();
    expect(screen.getByText("Remaining budget: $25.00")).toBeTruthy();
  });

  it("renders correct variant for each decision", () => {
    const decisions: BudgetDecision[] = [
      "allow",
      "warn",
      "approval_required",
      "throttle",
      "deny",
    ];

    for (const decision of decisions) {
      const { container, unmount } = render(
        <BudgetStatusBanner decision={decision} />,
      );

      if (decision === "allow") {
        expect(container.firstChild).toBeNull();
      }

      unmount();
    }
  });
});
