import { describe, expect, it } from "vitest";
import { CreateAgentSkillSchema, SkillScopeSchema } from "./skills.schema";

const VALID_MARKDOWN = "---\nname: my-skill\ndescription: d\n---\n# Body";

describe("SkillScopeSchema", () => {
  it("accepts project/agent/workflow string arrays", () => {
    const parsed = SkillScopeSchema.parse({
      projects: ["scope-123"],
      agents: ["software-architect"],
      workflows: ["create_skill"],
    });
    expect(parsed.projects).toEqual(["scope-123"]);
    expect(parsed.agents).toEqual(["software-architect"]);
    expect(parsed.workflows).toEqual(["create_skill"]);
  });

  it("accepts an empty object (all axes optional)", () => {
    expect(SkillScopeSchema.parse({})).toEqual({});
  });

  it("rejects empty strings in arrays", () => {
    const result = SkillScopeSchema.safeParse({ projects: [""] });
    expect(result.success).toBe(false);
  });

  it("allows CreateAgentSkillSchema to carry an optional scope", () => {
    const parsed = CreateAgentSkillSchema.parse({
      name: "my-skill",
      description: "d",
      skill_markdown: VALID_MARKDOWN,
      scope: { projects: ["scope-123"] },
    });
    expect(parsed.scope?.projects).toEqual(["scope-123"]);
  });
});
