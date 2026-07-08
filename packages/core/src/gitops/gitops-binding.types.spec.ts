import { describe, expect, it } from "vitest";
import {
  GITOPS_BINDING_SYNC_MODES,
  GITOPS_SYNCABLE_OBJECT_TYPES,
  isGitOpsBindingSyncMode,
  isGitOpsSyncableObjectType,
} from "./gitops-binding.types";

describe("gitops binding types", () => {
  it("supports one-way and two-way sync modes", () => {
    expect(GITOPS_BINDING_SYNC_MODES).toEqual(["git_to_app", "two_way"]);
    expect(isGitOpsBindingSyncMode("git_to_app")).toBe(true);
    expect(isGitOpsBindingSyncMode("two_way")).toBe(true);
    expect(isGitOpsBindingSyncMode("cli")).toBe(false);
  });

  it("keeps syncable object names generic", () => {
    expect(GITOPS_SYNCABLE_OBJECT_TYPES).toEqual([
      "scope_node",
      "role",
      "role_assignment",
      "workflow",
      "agent_profile",
      "skill",
    ]);
    expect(isGitOpsSyncableObjectType("workflow")).toBe(true);
    expect(isGitOpsSyncableObjectType("project")).toBe(false);
  });
});
