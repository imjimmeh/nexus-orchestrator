import type {
  AgentProfilePatch,
  ToolPolicyDocument,
  UpdateAgentProfileRequest,
} from '@nexus/core';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import type {
  AgentProfileRollbackRestore,
  AgentProfileRollbackSnapshot,
} from './agent-profile-change.applier.types';

/**
 * Captures the 7 fields an `agent_profile_change` patch can ever touch, plus
 * the identifiers `rollback()` needs to find the profile again. Called once,
 * before any mutation (`persistRollbackSnapshotOnce` guarantees the snapshot
 * is never overwritten by a partially-mutated retry).
 */
export function buildProfileRollbackSnapshot(
  profile: AgentProfile,
): AgentProfileRollbackSnapshot {
  return {
    profileId: profile.id,
    profileName: profile.name,
    system_prompt: profile.system_prompt ?? null,
    model_name: profile.model_name ?? null,
    provider_name: profile.provider_name ?? null,
    thinking_level: profile.thinking_level ?? null,
    tool_policy: profile.tool_policy ?? null,
    assigned_skills: profile.assigned_skills ?? null,
    overrides: profile.overrides ?? null,
  };
}

/**
 * Translates a validated {@link AgentProfilePatch} into the request shape
 * `AiConfigAdminService.updateAgentProfile` (and its `UpdateAgentProfileSchema`
 * validation) expects. `assigned_skills` is deliberately omitted: it is
 * applied through `AgentSkillsService.addProfileSkills`/`removeProfileSkills`
 * instead, since the schema has no field for it.
 */
export function buildProfileUpdateRequest(
  profile: AgentProfile,
  patch: AgentProfilePatch,
): UpdateAgentProfileRequest {
  const request: UpdateAgentProfileRequest = {};

  if (patch.system_prompt) {
    request.system_prompt = composeSystemPrompt(
      patch.system_prompt.mode,
      profile.system_prompt ?? null,
      patch.system_prompt.value,
    );
  }
  if (patch.model_name !== undefined) {
    request.model_name = patch.model_name;
  }
  if (patch.provider_name !== undefined) {
    request.provider_name = patch.provider_name;
  }
  if (patch.thinking_level !== undefined) {
    request.thinking_level = patch.thinking_level;
  }
  if (patch.tool_policy !== undefined) {
    request.tool_policy = patch.tool_policy;
  }

  return request;
}

/**
 * Routes a rollback snapshot's fields to whichever restore path can express
 * them. `system_prompt`/`model_name`/`provider_name` are non-nullable on
 * `UpdateAgentProfileSchema`, so a snapshot that captured `null` for one of
 * those (the profile had no value before the patch) falls back to the raw
 * repository path; `tool_policy`/`thinking_level` are nullable on the schema
 * and always route through the service.
 */
export function splitRollbackRestore(
  snapshot: AgentProfileRollbackSnapshot,
): AgentProfileRollbackRestore {
  const serviceFields: UpdateAgentProfileRequest = {
    tool_policy: snapshot.tool_policy,
    // The snapshot stores the entity's plain `string | null` column value;
    // it was only ever set through this same schema's validated enum, so
    // reasserting the narrower runtime-level union here is safe.
    thinking_level:
      snapshot.thinking_level as UpdateAgentProfileRequest['thinking_level'],
  };
  const rawFields: Partial<AgentProfile> = {
    assigned_skills: snapshot.assigned_skills,
    overrides: snapshot.overrides,
  };

  assignNullableSchemaField(
    serviceFields,
    rawFields,
    'system_prompt',
    snapshot.system_prompt,
  );
  assignNullableSchemaField(
    serviceFields,
    rawFields,
    'model_name',
    snapshot.model_name,
  );
  assignNullableSchemaField(
    serviceFields,
    rawFields,
    'provider_name',
    snapshot.provider_name,
  );

  return { serviceFields, rawFields };
}

/**
 * Parses a proposal's `rollback_data` back into an
 * {@link AgentProfileRollbackSnapshot}. Rolling back without a snapshot is a
 * hard error — there is nothing safe to restore to — so this throws rather
 * than silently no-op-ing on absent or malformed data.
 */
export function parseProfileRollbackSnapshot(
  rollbackData: unknown,
): AgentProfileRollbackSnapshot {
  if (!rollbackData || typeof rollbackData !== 'object') {
    throw new Error(
      'agent_profile_change rollback requires a snapshot, but rollback_data is absent',
    );
  }
  const data = rollbackData as Record<string, unknown>;
  if (typeof data.profileId !== 'string' || data.profileId.length === 0) {
    throw new Error(
      'agent_profile_change rollback_data is missing a profileId',
    );
  }

  return {
    profileId: data.profileId,
    profileName: typeof data.profileName === 'string' ? data.profileName : '',
    system_prompt: toNullableString(data.system_prompt),
    model_name: toNullableString(data.model_name),
    provider_name: toNullableString(data.provider_name),
    thinking_level: toNullableString(data.thinking_level),
    tool_policy:
      (data.tool_policy as ToolPolicyDocument | null | undefined) ?? null,
    assigned_skills: Array.isArray(data.assigned_skills)
      ? (data.assigned_skills as string[])
      : null,
    overrides:
      (data.overrides as Record<string, unknown> | null | undefined) ?? null,
  };
}

function composeSystemPrompt(
  mode: 'append' | 'replace',
  existing: string | null,
  value: string,
): string {
  if (mode === 'replace') {
    return value;
  }
  return existing && existing.length > 0 ? `${existing}\n\n${value}` : value;
}

/**
 * Assigns a snapshot value that is non-nullable on `UpdateAgentProfileSchema`
 * (`system_prompt`, `model_name`, `provider_name`): routes a non-null value
 * through the service path, a null value through the raw repository path.
 */
function assignNullableSchemaField(
  serviceFields: UpdateAgentProfileRequest,
  rawFields: Partial<AgentProfile>,
  field: 'system_prompt' | 'model_name' | 'provider_name',
  value: string | null,
): void {
  if (value !== null) {
    serviceFields[field] = value;
  } else {
    rawFields[field] = null;
  }
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
