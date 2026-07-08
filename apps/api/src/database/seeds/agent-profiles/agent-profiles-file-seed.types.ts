import type { AgentProfileSeedDefinition } from './agent-profiles.types';

export interface AgentSeedConfigFile {
  name?: unknown;
  tier_preference?: unknown;
  supports_vision?: unknown;
  allowed_tools?: unknown;
  denied_tools?: unknown;
  approval_required_tools?: unknown;
  model_name?: unknown;
  provider_name?: unknown;
  provider_id?: unknown;
  provider_source?: unknown;
  tool_policy?: unknown;
  allowed_mount_aliases?: unknown;
  denied_mount_aliases?: unknown;
  allow_rw_mount_aliases?: unknown;
  assigned_skills?: unknown;
  is_active?: unknown;
}

export type LegacyAssignmentsSeed = Record<string, unknown>;

export interface ParsedAgentProfileSeed {
  definition: AgentProfileSeedDefinition;
  usedLegacyAssignments: boolean;
}

export type ResolvedSeedFilePaths = {
  configPath: string;
  promptPath: string;
};

export type ParsedCoreSeedConfig = {
  name: string;
  tierPreference: AgentProfileSeedDefinition['tier_preference'];
  supportsVision?: boolean;
  modelName?: string | null;
  providerName?: string | null;
  providerId?: string | null;
  providerSource?: 'global' | 'user' | 'scope' | null;
  toolPolicy?: AgentProfileSeedDefinition['tool_policy'];
};

export type ParsedMountAliasConfig = {
  allowedMountAliases?: string[];
  deniedMountAliases?: string[];
  allowRwMountAliases?: string[];
};

export type ProfileSeedDefinitionInput = ParsedCoreSeedConfig &
  ParsedMountAliasConfig & {
    systemPrompt: string;
    assignedSkills: string[];
    isActive: boolean;
  };

export type AgentProfileFileSeedLoadResult = {
  definitions: AgentProfileSeedDefinition[];
  seedRoot: string | null;
  usedLegacyAssignments: boolean;
  skillAssignmentValidation: {
    profileCount: number;
    profilesWithoutSkills: string[];
  };
};
