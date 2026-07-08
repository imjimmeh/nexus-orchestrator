import { describe, it, expect } from "vitest";
import {
  RoleDocSchema,
  AssignmentDocSchema,
  PermissionNameSchema,
} from "./rbac.schema";

describe("RBAC schemas", () => {
  it("accepts a well-formed permission name", () => {
    expect(PermissionNameSchema.parse("workflows:read")).toBe("workflows:read");
  });
  it("rejects a malformed permission name", () => {
    expect(PermissionNameSchema.safeParse("workflows").success).toBe(false);
    expect(PermissionNameSchema.safeParse("workflows:read:extra").success).toBe(
      false,
    );
  });
  it("parses an org-local custom RoleDoc", () => {
    const doc = RoleDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "Role",
      name: "release-manager",
      description: "Can manage releases",
      ownerScope: "/acme",
      permissions: ["workflows:manage", "work_items:update"],
    });
    expect(doc.ownerScope).toBe("/acme");
    expect(doc.permissions).toContain("workflows:manage");
  });
  it("allows a global custom role (ownerScope null)", () => {
    const doc = RoleDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "Role",
      name: "auditor",
      permissions: ["work_items:read"],
    });
    expect(doc.ownerScope).toBeNull();
  });
  it("parses an assignments file with multiple grants", () => {
    const doc = AssignmentDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "AssignmentList",
      assignments: [
        { user: "alice", role: "org_admin", scope: "/acme" },
        {
          user: "bob",
          role: "release-manager",
          scope: "/acme/emea/platform-team",
        },
      ],
    });
    expect(doc.assignments).toHaveLength(2);
  });
  it("rejects an assignment with a non-path scope", () => {
    expect(
      AssignmentDocSchema.safeParse({
        apiVersion: "nexus.gitops/v1",
        kind: "AssignmentList",
        assignments: [{ user: "a", role: "r", scope: "not-a-path" }],
      }).success,
    ).toBe(false);
  });
});
