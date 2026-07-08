export const GITOPS_BINDING_SYNC_MODES = ["git_to_app", "two_way"] as const;

export type GitOpsBindingSyncMode = (typeof GITOPS_BINDING_SYNC_MODES)[number];

export function isGitOpsBindingSyncMode(
  value: string,
): value is GitOpsBindingSyncMode {
  return (GITOPS_BINDING_SYNC_MODES as readonly string[]).includes(value);
}

export const GITOPS_SYNCABLE_OBJECT_TYPES = [
  "scope_node",
  "role",
  "role_assignment",
  "workflow",
  "agent_profile",
  "skill",
] as const;

export type GitOpsSyncableObjectType =
  (typeof GITOPS_SYNCABLE_OBJECT_TYPES)[number];

export function isGitOpsSyncableObjectType(
  value: string,
): value is GitOpsSyncableObjectType {
  return (GITOPS_SYNCABLE_OBJECT_TYPES as readonly string[]).includes(value);
}
