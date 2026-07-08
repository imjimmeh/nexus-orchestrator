import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SteeringPlanCard } from "./SteeringPlanCard";
import { SteeringPlan, SteeringProposedChange } from "@/lib/api/steering.types";

function buildChange(
  overrides: Partial<SteeringProposedChange> = {},
): SteeringProposedChange {
  return {
    type: "update_artifact",
    description: "Update the auth module spec",
    ...overrides,
  };
}

function buildPlan(overrides: Partial<SteeringPlan> = {}): SteeringPlan {
  return {
    id: "plan-1",
    intent: "add_feature",
    target_area: "auth",
    description: "Add OAuth2 support to the auth module",
    proposed_changes: [buildChange()],
    confidence: 0.85,
    questions_for_user: [],
    context_summary: {
      work_item_count: 5,
      active_work_items: 2,
      has_artifacts: true,
      recent_commits: 3,
    },
    status: "proposed",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SteeringPlanCard", () => {
  it("renders plan header with intent badge and confidence", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ intent: "add_feature", confidence: 0.85 })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Steering Plan")).toBeTruthy();
    expect(screen.getByText("Add Feature")).toBeTruthy();
    expect(screen.getByText("85% confidence")).toBeTruthy();
    expect(screen.getByText("auth")).toBeTruthy();
  });

  it("renders the plan description", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ description: "Add OAuth2 support" })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Add OAuth2 support")).toBeTruthy();
  });

  it("renders proposed changes with kanban-owned type labels", () => {
    const changes: SteeringProposedChange[] = [
      buildChange({
        type: "update_artifact",
        description: "Update the spec file",
        entity_type: undefined,
        workflow_name: undefined,
      }),
      buildChange({
        type: "create_work_item",
        description: "Create the auth implementation ticket",
        entity_type: "work_item",
        workflow_name: undefined,
      }),
      buildChange({
        type: "invoke_workflow",
        description: "Run the deploy pipeline",
        workflow_name: "deploy",
        entity_type: undefined,
      }),
    ];

    render(
      <SteeringPlanCard
        plan={buildPlan({ proposed_changes: changes })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Update the spec file")).toBeTruthy();
    expect(
      screen.getByText("Create the auth implementation ticket"),
    ).toBeTruthy();
    expect(screen.getByText("Run the deploy pipeline")).toBeTruthy();
    expect(screen.getByText("(work_item)")).toBeTruthy();
    expect(screen.getByText("[deploy]")).toBeTruthy();
  });

  it("quarantines legacy amend_entity changes instead of rendering them as supported actions", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({
          proposed_changes: [
            buildChange({
              type: "amend_entity" as unknown as SteeringProposedChange["type"],
              description: "Modify the auth service",
              entity_type: "service",
            }),
          ],
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText("Modify the auth service")).toBeNull();
    expect(
      screen.getByText("Unsupported legacy steering action hidden."),
    ).toBeTruthy();
  });

  it("renders context summary when present", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({
          context_summary: {
            work_item_count: 7,
            active_work_items: 3,
            has_artifacts: true,
            recent_commits: 12,
          },
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("7 work items")).toBeTruthy();
    expect(screen.getByText("3 active")).toBeTruthy();
    expect(screen.getByText("Has specs")).toBeTruthy();
    expect(screen.getByText("12 recent commits")).toBeTruthy();
  });

  it("shows no specs indicator when has_artifacts is false", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({
          context_summary: {
            work_item_count: 1,
            active_work_items: 0,
            has_artifacts: false,
            recent_commits: 0,
          },
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("No specs")).toBeTruthy();
  });

  it("omits context summary section when not provided", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ context_summary: undefined })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText("work items")).toBeNull();
  });

  it("renders clickable clarity questions when onClarify is provided", async () => {
    const user = userEvent.setup();
    const clarify = vi.fn();

    render(
      <SteeringPlanCard
        plan={buildPlan({
          questions_for_user: [
            "Which auth provider?",
            "Should we keep backward compat?",
          ],
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
        onClarify={clarify}
      />,
    );

    expect(screen.getByText("Which auth provider?")).toBeTruthy();
    expect(screen.getByText("Should we keep backward compat?")).toBeTruthy();

    await user.click(screen.getByText("Which auth provider?"));
    expect(clarify).toHaveBeenCalledWith("Which auth provider?");
  });

  it("omits questions section when onClarify is not provided", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({
          questions_for_user: ["Which auth provider?"],
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText("Which auth provider?")).toBeNull();
  });

  it("calls onApprove when Approve button is clicked", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();

    render(
      <SteeringPlanCard
        plan={buildPlan()}
        onApprove={onApprove}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("calls onModify when Modify button is clicked", async () => {
    const user = userEvent.setup();
    const onModify = vi.fn();

    render(
      <SteeringPlanCard
        plan={buildPlan()}
        onApprove={vi.fn()}
        onModify={onModify}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Modify" }));
    expect(onModify).toHaveBeenCalledOnce();
  });

  it("calls onReject when Reject button is clicked", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();

    render(
      <SteeringPlanCard
        plan={buildPlan()}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={onReject}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("disables all action buttons when disabled prop is true", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan()}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
        disabled
      />,
    );

    expect(
      screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Modify" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows default variant badge for high confidence", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ confidence: 0.9 })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const intentBadge = screen.getByText("Add Feature");
    expect(intentBadge.closest("[class]")?.className).toContain("bg-primary");
  });

  it("shows destructive variant badge for low confidence", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ confidence: 0.3 })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const intentBadge = screen.getByText("Add Feature");
    const badgeEl = intentBadge.closest("[class]");
    expect(badgeEl).toBeTruthy();
    if (!badgeEl) {
      return;
    }
    expect(badgeEl.className).toContain("bg-destructive");
  });

  it("shows secondary variant badge for medium confidence", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ confidence: 0.65 })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const intentBadge = screen.getByText("Add Feature");
    const badgeEl = intentBadge.closest("[class]");
    expect(badgeEl).toBeTruthy();
    if (!badgeEl) {
      return;
    }
    expect(badgeEl.className).toContain("bg-secondary");
  });

  it("uses raw intent string for unknown intents", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ intent: "custom_intent" })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("custom_intent")).toBeTruthy();
  });

  it("disables clarify question buttons when disabled", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({
          questions_for_user: ["Which provider?"],
        })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
        onClarify={vi.fn()}
        disabled
      />,
    );

    const questionButton = screen.getByText("Which provider?");
    expect(questionButton.hasAttribute("disabled")).toBe(true);
  });

  it("renders proposed changes section heading only when changes exist", () => {
    render(
      <SteeringPlanCard
        plan={buildPlan({ proposed_changes: [] })}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.queryByText("Proposed Changes:")).toBeNull();
  });
});
