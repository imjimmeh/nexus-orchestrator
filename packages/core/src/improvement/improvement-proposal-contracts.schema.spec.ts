import { describe, expect, it } from "vitest";
import {
  bulkRejectImprovementProposalsSchema,
  createSkillAssignmentProposalSchema,
  listImprovementProposalsSchema,
} from "./improvement-proposal-contracts.schema";

describe("listImprovementProposalsSchema", () => {
  it("parses a comma-separated kind filter into an array", () => {
    expect(
      listImprovementProposalsSchema.parse({ kind: "skill_create,code_change" })
        .kind,
    ).toEqual(["skill_create", "code_change"]);
  });

  it("passes through an already-array kind filter (e.g. ?kind=a&kind=b)", () => {
    expect(
      listImprovementProposalsSchema.parse({
        kind: ["skill_create", "code_change"],
      }).kind,
    ).toEqual(["skill_create", "code_change"]);
  });

  it("passes through an already-array status filter", () => {
    expect(
      listImprovementProposalsSchema.parse({
        status: ["pending", "approved"],
      }).status,
    ).toEqual(["pending", "approved"]);
  });

  it("trims and drops empty entries from an array status filter", () => {
    expect(
      listImprovementProposalsSchema.parse({
        status: [" pending ", "", "approved"],
      }).status,
    ).toEqual(["pending", "approved"]);
  });

  it("leaves kind undefined when omitted", () => {
    expect(listImprovementProposalsSchema.parse({}).kind).toBeUndefined();
  });

  it("rejects an invalid kind in an array filter", () => {
    expect(() =>
      listImprovementProposalsSchema.parse({ kind: ["not_a_real_kind"] }),
    ).toThrow();
  });

  it("rejects an invalid status in a CSV filter", () => {
    expect(() =>
      listImprovementProposalsSchema.parse({ status: "not_a_real_status" }),
    ).toThrow();
  });

  it("defaults pagination to page 1 / limit 25", () => {
    expect(listImprovementProposalsSchema.parse({})).toMatchObject({
      page: 1,
      limit: 25,
    });
  });
});

describe("bulkRejectImprovementProposalsSchema", () => {
  it("accepts a list of proposal ids without a reason", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      bulkRejectImprovementProposalsSchema.parse({ proposal_ids: [id] }),
    ).toEqual({ proposal_ids: [id] });
  });

  it("accepts an optional reason", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      bulkRejectImprovementProposalsSchema.parse({
        proposal_ids: [id],
        reason: "duplicate",
      }),
    ).toEqual({ proposal_ids: [id], reason: "duplicate" });
  });

  it("rejects an empty proposal_ids array", () => {
    expect(() =>
      bulkRejectImprovementProposalsSchema.parse({ proposal_ids: [] }),
    ).toThrow();
  });
});

describe("createSkillAssignmentProposalSchema", () => {
  it("accepts a skillName + agent_profile target without a rationale", () => {
    expect(
      createSkillAssignmentProposalSchema.parse({
        skillName: "merge-doctor",
        targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      }),
    ).toEqual({
      skillName: "merge-doctor",
      targets: [{ type: "agent_profile", profileName: "merge-agent" }],
    });
  });

  it("accepts a workflow_step target with an optional rationale", () => {
    expect(
      createSkillAssignmentProposalSchema.parse({
        skillName: "merge-doctor",
        targets: [
          { type: "workflow_step", workflowName: "merge-flow", stepId: "s1" },
        ],
        rationale: "operator wants this bound explicitly",
      }),
    ).toEqual({
      skillName: "merge-doctor",
      targets: [
        { type: "workflow_step", workflowName: "merge-flow", stepId: "s1" },
      ],
      rationale: "operator wants this bound explicitly",
    });
  });

  it("rejects an empty skillName", () => {
    expect(() =>
      createSkillAssignmentProposalSchema.parse({
        skillName: "",
        targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      }),
    ).toThrow();
  });

  it("rejects an empty targets array", () => {
    expect(() =>
      createSkillAssignmentProposalSchema.parse({
        skillName: "merge-doctor",
        targets: [],
      }),
    ).toThrow();
  });

  it("rejects a target with an unrecognized type discriminator", () => {
    expect(() =>
      createSkillAssignmentProposalSchema.parse({
        skillName: "merge-doctor",
        targets: [{ type: "not_a_real_target" }],
      }),
    ).toThrow();
  });
});
