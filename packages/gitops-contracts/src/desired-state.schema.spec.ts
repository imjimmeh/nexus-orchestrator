import { describe, it, expect } from "vitest";
import { DesiredStateSchema } from "./desired-state.schema";

describe("DesiredStateSchema", () => {
  it("parses a minimal tree with just the root node", () => {
    const state = DesiredStateSchema.parse({
      apiVersion: "nexus.gitops/v1",
      nodes: [
        {
          path: "/",
          doc: {
            apiVersion: "nexus.gitops/v1",
            kind: "ScopeNode",
            type: "platform",
            name: "Platform",
            slug: "platform",
          },
        },
      ],
      roles: [],
      assignments: [],
      agents: [],
      workflows: [],
      skills: [],
      agentOverrides: [],
      workflowOverrides: [],
      skillOverrides: [],
    });
    expect(state.nodes).toHaveLength(1);
  });

  it("parses first-class platform config definitions", () => {
    const state = DesiredStateSchema.parse({
      apiVersion: "nexus.gitops/v1",
      nodes: [
        {
          path: "/",
          doc: {
            apiVersion: "nexus.gitops/v1",
            kind: "ScopeNode",
            type: "platform",
            name: "Platform",
            slug: "platform",
          },
        },
      ],
      roles: [],
      assignments: [],
      agents: [
        {
          apiVersion: "nexus.gitops/v1",
          kind: "AgentProfile",
          name: "ceo-agent",
          source: "seeded",
          locked: false,
          definition: { system_prompt: "Lead." },
        },
      ],
      workflows: [
        {
          apiVersion: "nexus.gitops/v1",
          kind: "Workflow",
          name: "hotfix-flow",
          source: "seeded",
          locked: false,
          definition: { yaml_definition: "name: hotfix-flow\n" },
        },
      ],
      skills: [
        {
          apiVersion: "nexus.gitops/v1",
          kind: "Skill",
          name: "code-review",
          source: "seeded",
          locked: false,
          definition: { skill_markdown: "# Review\n" },
        },
      ],
      agentOverrides: [],
      workflowOverrides: [],
      skillOverrides: [],
    });
    expect(state.agents.map((agent) => agent.name)).toEqual(["ceo-agent"]);
    expect(state.workflows.map((workflow) => workflow.name)).toEqual([
      "hotfix-flow",
    ]);
    expect(state.skills.map((skill) => skill.name)).toEqual(["code-review"]);
  });
});
