import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillBindingUsageCard } from "./SkillBindingUsageCard";
import type { SkillBindingUsage } from "@/lib/api/self-improvement.types";

function renderCard(
  snapshot: SkillBindingUsage[] | undefined,
  isLoading?: boolean,
) {
  return render(
    <SkillBindingUsageCard snapshot={snapshot} isLoading={isLoading} />,
  );
}

describe("SkillBindingUsageCard", () => {
  it("renders the card-level loading placeholder when no snapshot is provided", () => {
    renderCard(undefined);

    expect(screen.getByText("Skill Binding Usage")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders the empty state when the bindings array is empty", () => {
    renderCard([]);

    expect(screen.getByText("Skill Binding Usage")).toBeTruthy();
    expect(screen.getByText("No active skill bindings")).toBeTruthy();
  });

  it("applies the destructive variant when reuseCount7d is zero", () => {
    const binding: SkillBindingUsage = {
      id: "binding-a",
      mostSpecificSource: "workflow",
      reuseCount7d: 0,
      workflowStepIds: [],
    };
    renderCard([binding]);

    const badge = screen.getByText("reuse 0 / 7d (never referenced)");
    expect(badge.className).toContain("bg-destructive");
  });

  it("applies the success variant when reuseCount7d is positive", () => {
    const binding: SkillBindingUsage = {
      id: "binding-a",
      mostSpecificSource: "step",
      reuseCount7d: 4,
      workflowStepIds: ["step-1"],
    };
    renderCard([binding]);

    const badge = screen.getByText("reuse 4 / 7d");
    expect(badge.className).toContain("bg-success/15");
  });

  it("renders the 'step' source badge when workflowStepIds is non-empty", () => {
    const binding: SkillBindingUsage = {
      id: "binding-a",
      mostSpecificSource: "step",
      reuseCount7d: 2,
      workflowStepIds: ["step-1"],
    };
    renderCard([binding]);

    const list = screen.getByRole("list");
    const [row] = within(list).getAllByRole("listitem") as [HTMLElement];
    expect(within(row).getByText("step")).toBeTruthy();
    expect(within(row).getByText("step_id: step-1")).toBeTruthy();
  });

  it("renders the 'workflow' source badge when workflowStepIds is empty", () => {
    const binding: SkillBindingUsage = {
      id: "binding-a",
      mostSpecificSource: "workflow",
      reuseCount7d: 0,
      workflowStepIds: [],
    };
    renderCard([binding]);

    const list = screen.getByRole("list");
    const [row] = within(list).getAllByRole("listitem") as [HTMLElement];
    expect(within(row).getByText("workflow")).toBeTruthy();
    expect(within(row).getByText("workflow-scoped (no step_id)")).toBeTruthy();
  });

  it("renders multiple rows when the snapshot carries several bindings", () => {
    const bindings: SkillBindingUsage[] = [
      {
        id: "binding-a",
        mostSpecificSource: "step",
        reuseCount7d: 3,
        workflowStepIds: ["step-1"],
      },
      {
        id: "binding-b",
        mostSpecificSource: "workflow",
        reuseCount7d: 0,
        workflowStepIds: [],
      },
    ];
    renderCard(bindings);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });
});
