import type { GitOpsSyncableObjectType } from "@/lib/api/client.gitops.types";

export const SYNCABLE_OBJECT_TYPES: Array<{
  type: GitOpsSyncableObjectType;
  label: string;
}> = [
  { type: "workflow", label: "Sync workflows" },
  { type: "agent_profile", label: "Sync agent profiles" },
  { type: "skill", label: "Sync skills" },
  { type: "role", label: "Sync roles" },
  { type: "role_assignment", label: "Sync role assignments" },
  { type: "scope_node", label: "Sync scope hierarchy" },
];

export function toggleObjectType(
  current: GitOpsSyncableObjectType[],
  type: GitOpsSyncableObjectType,
): GitOpsSyncableObjectType[] {
  return current.includes(type)
    ? current.filter((candidate) => candidate !== type)
    : [...current, type];
}
