import { describe, expect, it } from "vitest";
import { assignmentTargetSchema } from "./assignment-target.schema";

describe("assignmentTargetSchema", () => {
  it("accepts an agent_profile target", () => {
    expect(
      assignmentTargetSchema.parse({
        type: "agent_profile",
        profileName: "merge-agent",
      }),
    ).toEqual({ type: "agent_profile", profileName: "merge-agent" });
  });

  it("accepts a workflow_step target with an optional stepId", () => {
    expect(
      assignmentTargetSchema.parse({
        type: "workflow_step",
        workflowName: "merge-flow",
        stepId: "step-1",
      }),
    ).toEqual({
      type: "workflow_step",
      workflowName: "merge-flow",
      stepId: "step-1",
    });
  });

  it("accepts a workflow_step target without a stepId", () => {
    expect(
      assignmentTargetSchema.parse({
        type: "workflow_step",
        workflowName: "merge-flow",
      }),
    ).toEqual({ type: "workflow_step", workflowName: "merge-flow" });
  });

  it("rejects an unrecognized type discriminator", () => {
    expect(() =>
      assignmentTargetSchema.parse({ type: "not_a_real_target" }),
    ).toThrow();
  });

  it("rejects a missing type discriminator", () => {
    expect(() =>
      assignmentTargetSchema.parse({ profileName: "merge-agent" }),
    ).toThrow();
  });
});
