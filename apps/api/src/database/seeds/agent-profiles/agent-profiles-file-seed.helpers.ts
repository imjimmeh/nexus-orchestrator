import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AgentSeedConfigFile,
  ParsedMountAliasConfig,
  ResolvedSeedFilePaths,
  ProfileSeedDefinitionInput,
} from './agent-profiles-file-seed.types';
import type { AgentProfileSeedDefinition } from './agent-profiles.types';

type OptionalMountAliasParser = (
  raw: unknown,
  profileName: string,
  fieldName: string,
) => string[] | undefined | null;

const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function readSeedSystemPrompt(promptPath: string): string {
  return fs.readFileSync(promptPath, 'utf8').trim();
}

export function buildProfileSeedDefinition(
  input: ProfileSeedDefinitionInput,
): AgentProfileSeedDefinition {
  const definition: AgentProfileSeedDefinition = {
    name: input.name,
    system_prompt: input.systemPrompt,
    tier_preference: input.tierPreference,
    assigned_skills: input.assignedSkills,
    is_active: input.isActive,
  };

  if (input.supportsVision !== undefined) {
    definition.supports_vision = input.supportsVision;
  }

  if (input.allowedMountAliases) {
    definition.allowed_mount_aliases = input.allowedMountAliases;
  }

  if (input.deniedMountAliases) {
    definition.denied_mount_aliases = input.deniedMountAliases;
  }

  if (input.allowRwMountAliases) {
    definition.allow_rw_mount_aliases = input.allowRwMountAliases;
  }

  if (input.modelName !== undefined) {
    definition.model_name = input.modelName;
  }

  if (input.providerName !== undefined) {
    definition.provider_name = input.providerName;
  }

  if (input.providerId !== undefined) {
    definition.provider_id = input.providerId;
  }

  if (input.providerSource !== undefined) {
    definition.provider_source = input.providerSource;
  }

  if (input.toolPolicy) {
    definition.tool_policy = input.toolPolicy;
  }

  return definition;
}

export function resolveParsedMountAliasConfig(
  parsedConfig: AgentSeedConfigFile,
  profileName: string,
  parseOptionalMountAliases: OptionalMountAliasParser,
): ParsedMountAliasConfig | null {
  const allowedMountAliases = parseOptionalMountAliases(
    parsedConfig.allowed_mount_aliases,
    profileName,
    'allowed_mount_aliases',
  );
  if (allowedMountAliases === null) {
    return null;
  }

  const deniedMountAliases = parseOptionalMountAliases(
    parsedConfig.denied_mount_aliases,
    profileName,
    'denied_mount_aliases',
  );
  if (deniedMountAliases === null) {
    return null;
  }

  const allowRwMountAliases = parseOptionalMountAliases(
    parsedConfig.allow_rw_mount_aliases,
    profileName,
    'allow_rw_mount_aliases',
  );
  if (allowRwMountAliases === null) {
    return null;
  }

  return {
    allowedMountAliases,
    deniedMountAliases,
    allowRwMountAliases,
  };
}

export function resolveSeedFilePaths(params: {
  seedRoot: string;
  directoryName: string;
  agentConfigFile: string;
  agentPromptFile: string;
  warn: (message: string) => void;
}): ResolvedSeedFilePaths | null {
  const directoryPath = path.join(params.seedRoot, params.directoryName);
  const configPath = path.join(directoryPath, params.agentConfigFile);
  const promptPath = path.join(directoryPath, params.agentPromptFile);

  if (!fs.existsSync(configPath)) {
    params.warn(
      `Skipping agent seed ${params.directoryName}: missing ${params.agentConfigFile}`,
    );
    return null;
  }

  if (!fs.existsSync(promptPath)) {
    params.warn(
      `Skipping agent seed ${params.directoryName}: missing ${params.agentPromptFile}`,
    );
    return null;
  }

  return {
    configPath,
    promptPath,
  };
}

export function parseSeedAgentName(params: {
  raw: unknown;
  directoryName: string;
  agentConfigFile: string;
  warn: (message: string) => void;
}): string | null {
  if (typeof params.raw !== 'string') {
    params.warn(
      `Skipping agent seed ${params.directoryName}: ${params.agentConfigFile} name must be a string`,
    );
    return null;
  }

  const name = params.raw.trim();
  if (!name) {
    params.warn(
      `Skipping agent seed ${params.directoryName}: ${params.agentConfigFile} name is required`,
    );
    return null;
  }

  if (!AGENT_NAME_PATTERN.test(name)) {
    params.warn(
      `Skipping agent seed ${params.directoryName}: invalid agent name format (${name})`,
    );
    return null;
  }

  if (name !== params.directoryName) {
    params.warn(
      `Skipping agent seed ${params.directoryName}: directory name must match ${params.agentConfigFile} name (${name})`,
    );
    return null;
  }

  return name;
}

export function parseSeedTierPreference(params: {
  raw: unknown;
  profileName: string;
  warn: (message: string) => void;
}): AgentProfileSeedDefinition['tier_preference'] | null {
  if (params.raw !== 'light' && params.raw !== 'heavy') {
    params.warn(
      `Skipping agent seed ${params.profileName}: tier_preference must be light or heavy`,
    );
    return null;
  }

  return params.raw;
}

export function parseSeedStringList(params: {
  raw: unknown;
  profileName: string;
  fieldName: string;
  warn: (message: string) => void;
}): string[] | null {
  if (!Array.isArray(params.raw)) {
    params.warn(
      `Skipping agent seed ${params.profileName}: ${params.fieldName} must be an array`,
    );
    return null;
  }

  const normalized: string[] = [];
  for (const value of params.raw) {
    if (typeof value !== 'string') {
      params.warn(
        `Skipping agent seed ${params.profileName}: ${params.fieldName} must contain only strings`,
      );
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

export function parseSeedIsActive(params: {
  raw: unknown;
  profileName: string;
  warn: (message: string) => void;
}): boolean | null {
  if (params.raw === undefined) {
    return true;
  }

  if (typeof params.raw !== 'boolean') {
    params.warn(
      `Skipping agent seed ${params.profileName}: is_active must be a boolean when provided`,
    );
    return null;
  }

  return params.raw;
}

export function parseSeedAssignedSkills(params: {
  raw: unknown;
  profileName: string;
  legacyAssignments: Map<string, string[]>;
  knownSkillNames: Set<string>;
  skillNamePattern: RegExp;
  warn: (message: string) => void;
}): { assignedSkills: string[]; usedLegacyAssignments: boolean } | null {
  if (params.raw === undefined) {
    const legacyAssignedSkills = params.legacyAssignments.get(
      params.profileName,
    );
    if (!legacyAssignedSkills) {
      params.warn(
        `Agent seed ${params.profileName} has no assigned skills. Consider assigning at least one skill.`,
      );
      return {
        assignedSkills: [],
        usedLegacyAssignments: false,
      };
    }

    return {
      assignedSkills: legacyAssignedSkills,
      usedLegacyAssignments: true,
    };
  }

  const assignedSkills = parseSeedStringList({
    raw: params.raw,
    profileName: params.profileName,
    fieldName: 'assigned_skills',
    warn: params.warn,
  });
  if (!assignedSkills) {
    return null;
  }

  for (const skillName of assignedSkills) {
    if (!params.skillNamePattern.test(skillName)) {
      params.warn(
        `Skipping agent seed ${params.profileName}: invalid assigned skill (${skillName})`,
      );
      return null;
    }

    if (
      params.knownSkillNames.size > 0 &&
      !params.knownSkillNames.has(skillName)
    ) {
      params.warn(
        `Skipping agent seed ${params.profileName}: unknown assigned skill (${skillName})`,
      );
      return null;
    }
  }

  if (assignedSkills.length === 0) {
    params.warn(
      `Agent seed ${params.profileName} has no assigned skills. Consider assigning at least one skill.`,
    );
  }

  return {
    assignedSkills,
    usedLegacyAssignments: false,
  };
}
