import type { AgentProfileChangePayload } from "@nexus/core";
import type { ProfilePatchEntry } from "./improvements-detail.helpers.types";

type AssignedSkillsChange = NonNullable<
  AgentProfileChangePayload["patch"]["assigned_skills"]
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Renders a single patch/snapshot value as a table-friendly string. */
function stringifyPatchValue(value: unknown): string {
  if (value === null) return "(none)";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

/** Reads `snapshot[field]`, stringified, or `undefined` when absent. */
function readSnapshotField(
  snapshot: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  if (!snapshot || !(field in snapshot)) return undefined;
  return stringifyPatchValue(snapshot[field]);
}

function pushScalarEntry(
  entries: ProfilePatchEntry[],
  snapshotField: string,
  label: string,
  to: unknown,
  snapshot: Record<string, unknown> | undefined,
): void {
  const from = readSnapshotField(snapshot, snapshotField);
  entries.push({
    field: label,
    to: stringifyPatchValue(to),
    ...(from !== undefined ? { from } : {}),
  });
}

function pushAssignedSkillsEntries(
  entries: ProfilePatchEntry[],
  change: AssignedSkillsChange,
  snapshot: Record<string, unknown> | undefined,
): void {
  const from = readSnapshotField(snapshot, "assigned_skills");
  if (change.add && change.add.length > 0) {
    entries.push({
      field: "assigned_skills (add)",
      to: change.add.join(", "),
      ...(from !== undefined ? { from } : {}),
    });
  }
  if (change.remove && change.remove.length > 0) {
    entries.push({
      field: "assigned_skills (remove)",
      to: change.remove.join(", "),
      ...(from !== undefined ? { from } : {}),
    });
  }
}

/**
 * Flattens an `agent_profile_change` proposal's patch into a table-friendly
 * list of `{ field, from?, to }` rows. `from` is filled from the
 * `rollback_data` pre-mutation snapshot the applier persists — present once
 * the proposal has applied, absent for a still-pending proposal — so the
 * caller can render the `From` column dimmed/absent until then.
 */
export function formatProfilePatchEntries(
  payload: AgentProfileChangePayload,
  rollbackData: unknown,
): ProfilePatchEntry[] {
  const snapshot = isRecord(rollbackData) ? rollbackData : undefined;
  const { patch } = payload;
  const entries: ProfilePatchEntry[] = [];

  if (patch.system_prompt) {
    pushScalarEntry(
      entries,
      "system_prompt",
      `system_prompt (${patch.system_prompt.mode})`,
      patch.system_prompt.value,
      snapshot,
    );
  }
  if (patch.model_name !== undefined) {
    pushScalarEntry(
      entries,
      "model_name",
      "model_name",
      patch.model_name,
      snapshot,
    );
  }
  if (patch.provider_name !== undefined) {
    pushScalarEntry(
      entries,
      "provider_name",
      "provider_name",
      patch.provider_name,
      snapshot,
    );
  }
  if (patch.thinking_level !== undefined) {
    pushScalarEntry(
      entries,
      "thinking_level",
      "thinking_level",
      patch.thinking_level,
      snapshot,
    );
  }
  if (patch.tool_policy !== undefined) {
    pushScalarEntry(
      entries,
      "tool_policy",
      "tool_policy",
      patch.tool_policy,
      snapshot,
    );
  }
  if (patch.assigned_skills) {
    pushAssignedSkillsEntries(entries, patch.assigned_skills, snapshot);
  }

  return entries;
}
