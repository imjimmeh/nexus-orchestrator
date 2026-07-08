import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { SkillProposalDetail } from "./SkillProposalDetail";

function buildProposal(
  overrides: Partial<ImprovementProposal>,
): ImprovementProposal {
  return {
    id: "p1",
    kind: "skill_create",
    status: "pending",
    payload: {},
    evidence: {},
    confidence: 0.6,
    rollback_data: null,
    occurrence_count: 1,
    provenance: {},
    applied_at: null,
    rolled_back_at: null,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    ...overrides,
  };
}

describe("SkillProposalDetail", () => {
  it("renders the skill name, summary, patch and targets for a skill_create proposal", () => {
    const proposal = buildProposal({
      kind: "skill_create",
      payload: {
        target_skill_name: "retry-with-backoff",
        proposal_summary: "Retry transient network failures with backoff.",
        patch_markdown: "# retry-with-backoff\n\nUse exponential backoff.",
        assignment_targets: [
          { type: "agent_profile", profileName: "implement-agent" },
          {
            type: "workflow_step",
            workflowName: "implement_and_commit",
            stepId: "implement",
          },
        ],
      },
    });

    render(<SkillProposalDetail proposal={proposal} />);

    expect(screen.getByText("retry-with-backoff")).toBeInTheDocument();
    expect(
      screen.getByText("Retry transient network failures with backoff."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Use exponential backoff/)).toBeInTheDocument();
    expect(screen.getByText(/implement-agent/)).toBeInTheDocument();
    expect(
      screen.getByText(/implement_and_commit.*implement/),
    ).toBeInTheDocument();
  });

  it("renders the skill name and targets for a skill_assignment proposal", () => {
    const proposal = buildProposal({
      kind: "skill_assignment",
      payload: {
        skillName: "debugging-checklist",
        assignment_targets: [
          { type: "agent_profile", profileName: "qa-agent" },
        ],
      },
    });

    render(<SkillProposalDetail proposal={proposal} />);

    expect(screen.getByText("debugging-checklist")).toBeInTheDocument();
    expect(screen.getByText(/qa-agent/)).toBeInTheDocument();
    // skill_assignment has no patch/summary to render
    expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
  });

  it("shows applied vs unrouted binding provenance once the proposal has applied", () => {
    const proposal = buildProposal({
      kind: "skill_assignment",
      status: "applied",
      payload: {
        skillName: "debugging-checklist",
        assignment_targets: [
          { type: "agent_profile", profileName: "qa-agent" },
          { type: "workflow_step", workflowName: "ghost-workflow" },
        ],
      },
      rollback_data: {
        applied_targets: [{ type: "agent_profile", profileName: "qa-agent" }],
        unrouted_targets: [
          {
            target: { type: "workflow_step", workflowName: "ghost-workflow" },
            reason: "workflow not found: ghost-workflow",
          },
        ],
      },
    });

    render(<SkillProposalDetail proposal={proposal} />);

    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("Unrouted")).toBeInTheDocument();
    expect(
      screen.getByText(/workflow not found: ghost-workflow/),
    ).toBeInTheDocument();
  });

  it("labels the binding provenance as operator-directed for a ui_operator assignment", () => {
    const proposal = buildProposal({
      kind: "skill_assignment",
      status: "applied",
      payload: {
        skillName: "debugging-checklist",
        assignment_targets: [
          { type: "agent_profile", profileName: "qa-agent" },
        ],
      },
      provenance: { source: "ui_operator" },
      rollback_data: {
        applied_targets: [{ type: "agent_profile", profileName: "qa-agent" }],
      },
    });

    render(<SkillProposalDetail proposal={proposal} />);

    expect(screen.getByText(/operator-directed/i)).toBeInTheDocument();
  });

  it("does not show the operator-directed label for a non-operator assignment", () => {
    const proposal = buildProposal({
      kind: "skill_assignment",
      status: "applied",
      payload: {
        skillName: "debugging-checklist",
        assignment_targets: [
          { type: "agent_profile", profileName: "qa-agent" },
        ],
      },
      provenance: { source: "suggest_skill_assignment_tool" },
      rollback_data: {
        applied_targets: [{ type: "agent_profile", profileName: "qa-agent" }],
      },
    });

    render(<SkillProposalDetail proposal={proposal} />);

    expect(screen.queryByText(/operator-directed/i)).not.toBeInTheDocument();
  });
});
