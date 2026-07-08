import { describe, it, expect } from "vitest";
import { validateDesiredState } from "./validate-desired-state";
import type { DesiredState } from "./desired-state.schema";

const root = {
  path: "/",
  doc: {
    apiVersion: "nexus.gitops/v1",
    kind: "ScopeNode",
    type: "platform",
    name: "Platform",
    slug: "platform",
    metadata: null,
  } as const,
};
const acme = {
  path: "/acme",
  doc: {
    apiVersion: "nexus.gitops/v1",
    kind: "ScopeNode",
    type: "org",
    name: "Acme",
    slug: "acme",
    metadata: null,
  } as const,
};

function base(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    apiVersion: "nexus.gitops/v1",
    nodes: [root, acme],
    roles: [],
    assignments: [],
    agents: [],
    workflows: [],
    skills: [],
    agentOverrides: [],
    workflowOverrides: [],
    skillOverrides: [],
    ...overrides,
  };
}

const ctx = {
  knownPermissions: new Set(["workflows:manage", "work_items:read"]),
  knownSystemRoles: new Set(["org_admin", "member", "viewer"]),
  knownUsers: new Set(["alice"]),
  knownDefaultAgents: new Set(["ceo-agent"]),
  knownDefaultWorkflows: new Set(["hotfix-flow"]),
  knownDefaultSkills: new Set(["code-review"]),
};

describe("validateDesiredState", () => {
  it("passes a clean tree", () => {
    const res = validateDesiredState(base(), ctx);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("FAILS: assignment references an unknown scope path", () => {
    const res = validateDesiredState(
      base({
        assignments: [{ user: "alice", role: "org_admin", scope: "/ghost" }],
      }),
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "assignment.unknown_scope")).toBe(
      true,
    );
  });

  it("FAILS: assignment references an unknown role", () => {
    const res = validateDesiredState(
      base({
        assignments: [{ user: "alice", role: "wizard", scope: "/acme" }],
      }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "assignment.unknown_role")).toBe(
      true,
    );
  });

  it("FAILS: role grants a permission not in the catalog", () => {
    const res = validateDesiredState(
      base({
        roles: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "Role",
            name: "x",
            ownerScope: "/acme",
            permissions: ["fly:always"],
          },
        ],
      }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "role.unknown_permission")).toBe(
      true,
    );
  });

  it("FAILS: role ownerScope path does not exist", () => {
    const res = validateDesiredState(
      base({
        roles: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "Role",
            name: "x",
            ownerScope: "/ghost",
            permissions: ["workflows:manage"],
          },
        ],
      }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "role.unknown_owner_scope")).toBe(
      true,
    );
  });

  it("FAILS: orphan parent — a node whose parent path is missing", () => {
    const orphan = {
      path: "/acme/emea/team",
      doc: {
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "team",
        name: "T",
        slug: "team",
        metadata: null,
      } as const,
    };
    // /acme/emea is absent
    const res = validateDesiredState(
      base({ nodes: [root, acme, orphan] }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "scope.orphan_parent")).toBe(true);
  });

  it("FAILS: duplicate slug under the same parent", () => {
    const a = {
      path: "/acme/team",
      doc: {
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "team",
        name: "A",
        slug: "team",
        metadata: null,
      } as const,
    };
    const bSamePathDifferentName = {
      path: "/acme/team",
      doc: {
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "team",
        name: "B",
        slug: "team",
        metadata: null,
      } as const,
    };
    const res = validateDesiredState(
      base({ nodes: [root, acme, a, bSamePathDifferentName] }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "scope.duplicate_slug")).toBe(
      true,
    );
  });

  it("FAILS: override references an unknown default object", () => {
    const res = validateDesiredState(
      base({
        workflowOverrides: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "WorkflowOverride",
            name: "ghost-flow",
            scope: "/acme",
            source: "admin",
            locked: false,
            strategy: "merge",
            definition: null,
            overrides: { is_active: false },
          },
        ],
      }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "override.unknown_default")).toBe(
      true,
    );
  });

  it("accepts overrides that target defaults declared in the same repository", () => {
    const res = validateDesiredState(
      base({
        workflows: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "Workflow",
            name: "local-flow",
            source: "repository",
            locked: false,
            definition: { yaml_definition: "name: local-flow\n" },
          },
        ],
        workflowOverrides: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "WorkflowOverride",
            name: "local-flow",
            scope: "/acme",
            source: "admin",
            locked: false,
            strategy: "merge",
            definition: null,
            overrides: { is_active: false },
          },
        ],
      }),
      ctx,
    );
    expect(res.ok).toBe(true);
  });

  it("FAILS: override bound to an unknown scope path", () => {
    const res = validateDesiredState(
      base({
        agentOverrides: [
          {
            apiVersion: "nexus.gitops/v1",
            kind: "AgentOverride",
            name: "ceo-agent",
            scope: "/ghost",
            source: "admin",
            locked: false,
            strategy: "merge",
            definition: null,
            overrides: { x: 1 },
          },
        ],
      }),
      ctx,
    );
    expect(res.errors.some((e) => e.code === "override.unknown_scope")).toBe(
      true,
    );
  });
});
