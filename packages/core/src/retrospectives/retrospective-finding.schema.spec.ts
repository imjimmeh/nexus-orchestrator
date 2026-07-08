import { describe, expect, it } from "vitest";
import {
  RETROSPECTIVE_FINDING_KINDS,
  RETROSPECTIVE_SCOPE_HINTS,
  retrospectiveFindingSchema,
} from "./retrospective-finding.schema";

describe("retrospectiveFindingSchema definition-change kinds (Epic D)", () => {
  it("admits agent_profile_change and workflow_definition_change alongside the existing kinds", () => {
    expect(RETROSPECTIVE_FINDING_KINDS).toEqual([
      "memory",
      "skill_proposal",
      "agent_profile_change",
      "workflow_definition_change",
      "none",
    ]);
  });

  it("rejects an agent_profile_change finding without a profile_change payload", () => {
    const result = retrospectiveFindingSchema.safeParse({
      kind: "agent_profile_change",
      lesson: "The implementation agent keeps skipping the linter.",
      confidence_self: 0.6,
      evidence_event_ids: ["evt-1"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an agent_profile_change finding with a valid profile_change payload", () => {
    const result = retrospectiveFindingSchema.safeParse({
      kind: "agent_profile_change",
      lesson: "The implementation agent keeps skipping the linter.",
      confidence_self: 0.6,
      evidence_event_ids: ["evt-1"],
      profile_change: {
        profileName: "implementation-agent",
        patch: {
          system_prompt: { mode: "append", value: "Always run the linter." },
        },
        changeSummary: "Append lint reminder",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a workflow_definition_change finding without a workflow_change payload", () => {
    const result = retrospectiveFindingSchema.safeParse({
      kind: "workflow_definition_change",
      lesson: "The gate step keeps timing out.",
      confidence_self: 0.5,
      evidence_event_ids: ["evt-1"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a workflow_definition_change finding with a valid workflow_change payload", () => {
    const result = retrospectiveFindingSchema.safeParse({
      kind: "workflow_definition_change",
      lesson: "The gate step keeps timing out.",
      confidence_self: 0.5,
      evidence_event_ids: ["evt-1"],
      workflow_change: {
        workflowName: "scope_split_default",
        proposedYaml: "workflow_id: scope_split_default\nname: Split\n",
        changeSummary: [
          {
            stepId: "implement",
            field: "max_retries",
            from: "0",
            to: "2",
            rationale: "unwinnable retry budget",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("retrospectiveFindingSchema scope hints (Epic C)", () => {
  it("admits workflow_specific alongside the existing hints", () => {
    expect(RETROSPECTIVE_SCOPE_HINTS).toEqual([
      "project",
      "global",
      "agent_preference",
      "workflow_specific",
    ]);

    const parsed = retrospectiveFindingSchema.parse({
      kind: "memory",
      lesson: "This workflow's retry budget masks the real failure.",
      root_cause: "quality gate timeout",
      fix: "raise the step timeout",
      scope_hint: "workflow_specific",
      confidence_self: 0.4,
      evidence_event_ids: ["evt-1"],
    });
    expect(parsed.scope_hint).toBe("workflow_specific");
  });
});
