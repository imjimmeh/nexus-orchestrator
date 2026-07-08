import { describe, expect, it } from "vitest";
import { MentionAgentSchema } from "./agent-mentions.schemas.js";
import { toJSONSchema } from "zod";

describe("MentionAgentSchema", () => {
  it("accepts canonical mention payload", () => {
    const input = {
      action: "mention_agent",
      target_agent_profile: "reviewer-agent",
      message: "Please review this implementation.",
      context_id: "ctx-1",
      context_files: [
        "apps/api/src/workflow/workflow-subagents/agent-communication-mesh.service.ts",
      ],
      urgency: "normal",
      thread_id: "thread-1",
      correlation_id: "corr-1",
    };

    expect(MentionAgentSchema.parse(input)).toEqual(input);
  });

  it("rejects unsupported identifier field", () => {
    expect(() =>
      MentionAgentSchema.parse({
        action: "mention_agent",
        target_agent_profile: "reviewer-agent",
        message: "Please review this implementation.",
        unsupported_context_id: "resource-1",
      }),
    ).toThrow();
  });

  it("does not publish unsupported identifier field in JSON schema", () => {
    const schemaJson = toJSONSchema(MentionAgentSchema);
    expect(schemaJson).toBeDefined();
    expect(schemaJson.properties).toBeDefined();
    expect(schemaJson.properties?.unsupported_context_id).toBeUndefined();
  });
});
