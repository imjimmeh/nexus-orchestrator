import { describe, expect, it } from "vitest";
import {
  AgentProfileChangePayloadSchema,
  WorkflowDefinitionChangePayloadSchema,
} from "./definition-change-payloads.schema";

describe("AgentProfileChangePayloadSchema", () => {
  it("accepts a system_prompt append patch", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: {
        system_prompt: { mode: "append", value: "Always run the linter." },
      },
      changeSummary: "Append lint reminder",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty patch", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: {},
      changeSummary: "no-op",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an assigned_skills change that neither adds nor removes", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: { assigned_skills: {} },
      changeSummary: "no-op skills",
    });
    expect(result.success).toBe(false);
  });
});

describe("WorkflowDefinitionChangePayloadSchema", () => {
  const changeSummary = [
    {
      stepId: "implement",
      field: "max_retries",
      from: "0",
      to: "2",
      rationale: "unwinnable retry budget",
    },
  ];

  it("accepts workflowName + full proposedYaml + changeSummary", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      workflowName: "scope_split_default",
      proposedYaml: "workflow_id: scope_split_default\nname: Split\n",
      changeSummary,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when neither workflowName nor workflowId is present", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      proposedYaml: "workflow_id: x\n",
      changeSummary,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty changeSummary", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      workflowId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
      proposedYaml: "workflow_id: x\n",
      changeSummary: [],
    });
    expect(result.success).toBe(false);
  });
});
