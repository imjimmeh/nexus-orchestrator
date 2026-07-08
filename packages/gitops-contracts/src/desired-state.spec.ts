import { describe, it, expect } from "vitest";
import {
  parseDesiredStateFiles,
  serializeDesiredState,
  GITOPS_LAYOUT,
} from "./desired-state";
import type { DesiredState } from "./desired-state.schema";

const sample: DesiredState = {
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
        metadata: null,
      },
    },
    {
      path: "/acme",
      doc: {
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "org",
        name: "Acme",
        slug: "acme",
        metadata: null,
      },
    },
  ],
  roles: [
    {
      apiVersion: "nexus.gitops/v1",
      kind: "Role",
      name: "auditor",
      ownerScope: null,
      permissions: ["work_items:read"],
    },
  ],
  assignments: [{ user: "alice", role: "auditor", scope: "/acme" }],
  agents: [
    {
      apiVersion: "nexus.gitops/v1",
      kind: "AgentProfile",
      name: "ceo-agent",
      source: "seeded",
      locked: false,
      definition: { system_prompt: "Lead the team." },
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
};

describe("desired-state file mapping", () => {
  it("serializes nodes to scopes/<path>/scope.yaml objects", () => {
    const files = serializeDesiredState(sample);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("scopes/scope.yaml"); // root
    expect(paths).toContain("scopes/acme/scope.yaml");
    expect(paths).toContain("roles/auditor.yaml");
    expect(paths).toContain("assignments.yaml");
    expect(paths).toContain("agents/ceo-agent.yaml");
    expect(paths).toContain("workflows/hotfix-flow.yaml");
    expect(paths).toContain("skills/code-review.yaml");
    expect(GITOPS_LAYOUT.scopesDir).toBe("scopes");
  });

  it("round-trips: parse(serialize(state)) deep-equals state", () => {
    const files = serializeDesiredState(sample);
    const parsed = parseDesiredStateFiles(files);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(sample);
  });

  it("parse reports a schema error for a malformed file instead of throwing", () => {
    const parsed = parseDesiredStateFiles([
      {
        path: "scopes/scope.yaml",
        content: {
          apiVersion: "nexus.gitops/v1",
          kind: "ScopeNode",
          type: "galaxy",
          name: "X",
          slug: "x",
        },
      },
    ]);
    expect(parsed.ok).toBe(false);
  });
});
