import type {
  ToolPolicyDocument,
  UpdateAgentProfileRequest,
} from '@nexus/core';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';

/**
 * Pre-mutation snapshot of the agent-profile fields an `agent_profile_change`
 * proposal is allowed to touch, persisted into `rollback_data` before
 * `AgentProfileChangeApplier.apply()` mutates anything. `rollback()` restores
 * the profile from exactly these fields, so the shape here must stay in sync
 * with every field `AgentProfilePatch` can express.
 */
export interface AgentProfileRollbackSnapshot {
  profileId: string;
  profileName: string;
  system_prompt: string | null;
  model_name: string | null;
  provider_name: string | null;
  thinking_level: string | null;
  tool_policy: ToolPolicyDocument | null;
  assigned_skills: string[] | null;
  overrides: Record<string, unknown> | null;
}

/**
 * `splitRollbackRestore` routes a snapshot's fields to whichever restore path
 * can express them: `serviceFields` reuses `AiConfigAdminService.updateAgentProfile`
 * (the human-edit path, including its IAM-policy refresh) for everything
 * `UpdateAgentProfileSchema` can validate; `rawFields` goes straight through
 * `AgentProfileRepository.update` for the values that schema cannot express
 * (a null `model_name`/`provider_name`/`system_prompt` restore, plus
 * `assigned_skills` and `overrides`, which are not part of the schema at all).
 */
export interface AgentProfileRollbackRestore {
  serviceFields: UpdateAgentProfileRequest;
  rawFields: Partial<AgentProfile>;
}
