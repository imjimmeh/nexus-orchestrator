import { describe, it, expect } from "vitest";
import {
  AgentOverrideDocSchema,
  WorkflowOverrideDocSchema,
  SkillOverrideDocSchema,
} from "./overrides.schema";

describe("override schemas", () => {
  it("parses an agent override with inline tool_policy and a prompt sidecar ref", () => {
    const doc = AgentOverrideDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "AgentOverride",
      name: "ceo-agent",
      scope: "/acme/emea/platform-team",
      source: "admin",
      locked: false,
      strategy: "merge",
      overrides: { tier_preference: "light" },
      bodyRef: "ceo-agent.PROMPT.md",
    });
    expect(doc.strategy).toBe("merge");
    expect(doc.bodyRef).toBe("ceo-agent.PROMPT.md");
  });
  it("parses a workflow replace override with an inline definition", () => {
    const doc = WorkflowOverrideDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "WorkflowOverride",
      name: "hotfix-flow",
      scope: "/acme",
      source: "admin",
      locked: true,
      strategy: "replace",
      definition: { is_active: false },
    });
    expect(doc.locked).toBe(true);
    expect(doc.definition).toEqual({ is_active: false });
  });
  it("rejects a replace override that has neither definition nor bodyRef", () => {
    expect(
      WorkflowOverrideDocSchema.safeParse({
        apiVersion: "nexus.gitops/v1",
        kind: "WorkflowOverride",
        name: "wf",
        scope: "/acme",
        source: "admin",
        locked: false,
        strategy: "replace",
      }).success,
    ).toBe(false);
  });
  it("rejects a merge override that has no overrides patch", () => {
    expect(
      SkillOverrideDocSchema.safeParse({
        apiVersion: "nexus.gitops/v1",
        kind: "SkillOverride",
        name: "code-review",
        scope: "/acme",
        source: "admin",
        locked: false,
        strategy: "merge",
      }).success,
    ).toBe(false);
  });
});
