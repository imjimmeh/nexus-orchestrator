import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import { isToolPolicyDocument } from '@nexus/core';
import type { AgentProfileSeedDefinition } from './agent-profiles.types';
import {
  buildProfileSeedDefinition,
  parseSeedAgentName,
  parseSeedAssignedSkills,
  parseSeedIsActive,
  parseSeedStringList,
  parseSeedTierPreference,
  readSeedSystemPrompt,
  resolveParsedMountAliasConfig,
  resolveSeedFilePaths,
} from './agent-profiles-file-seed.helpers';
import {
  AgentProfileFileSeedLoadResult,
  AgentSeedConfigFile,
  LegacyAssignmentsSeed,
  ParsedCoreSeedConfig,
  ParsedAgentProfileSeed,
} from './agent-profiles-file-seed.types';
import {
  listAgentDirectories,
  listKnownSeedSkillNames,
  resolveAgentsSeedRoot,
  resolveLegacyAssignmentsPath,
} from './agent-profiles-file-seed-paths';
import { parseLegacyAssignments } from './agent-profiles-legacy-assignments.utils';

const AGENT_CONFIG_FILE = 'agent.json';
const AGENT_PROMPT_FILE = 'PROMPT.md';
const LEGACY_ASSIGNMENTS_FILE = 'skill-assignments.seed.json';
const SKILL_MARKDOWN_FILE = 'SKILL.md';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
export class AgentProfilesFileSeedService {
  private readonly logger = new Logger(AgentProfilesFileSeedService.name);
  private readonly configuredAgentsSeedRoot: string | null;
  private readonly configuredAssignmentsPath: string | null;
  private readonly configuredSkillsSeedRoot: string | null;
  private readonly warn = (message: string): void => {
    this.logger.warn(message);
  };

  constructor() {
    this.configuredAgentsSeedRoot =
      process.env.NEXUS_AGENTS_SEED_PATH?.trim() || null;

    this.configuredAssignmentsPath =
      process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH?.trim() || null;

    this.configuredSkillsSeedRoot =
      process.env.NEXUS_SKILLS_SEED_PATH?.trim() || null;
  }

  hasFileSeedDefinitions(): boolean {
    const { definitions } = this.loadDefinitions();
    return definitions.length > 0;
  }

  loadDefinitions(): AgentProfileFileSeedLoadResult {
    const seedRoot = resolveAgentsSeedRoot(this.configuredAgentsSeedRoot);
    if (!seedRoot) {
      return {
        definitions: [],
        seedRoot: null,
        usedLegacyAssignments: false,
        skillAssignmentValidation: {
          profileCount: 0,
          profilesWithoutSkills: [],
        },
      };
    }

    const directoryNames = listAgentDirectories(seedRoot);
    if (directoryNames.length === 0) {
      return {
        definitions: [],
        seedRoot,
        usedLegacyAssignments: false,
        skillAssignmentValidation: {
          profileCount: 0,
          profilesWithoutSkills: [],
        },
      };
    }

    const legacyAssignments = this.loadLegacyAssignments();
    const knownSkillNames = listKnownSeedSkillNames({
      configuredSkillsSeedRoot: this.configuredSkillsSeedRoot,
      skillMarkdownFile: SKILL_MARKDOWN_FILE,
    });

    let usedLegacyAssignments = false;
    const definitions: AgentProfileSeedDefinition[] = [];

    for (const directoryName of directoryNames) {
      const parsed = this.parseAgentProfileSeed(
        seedRoot,
        directoryName,
        legacyAssignments,
        knownSkillNames,
      );

      if (!parsed) {
        continue;
      }

      if (parsed.usedLegacyAssignments) {
        usedLegacyAssignments = true;
      }

      definitions.push(parsed.definition);
    }

    return {
      definitions,
      seedRoot,
      usedLegacyAssignments,
      skillAssignmentValidation: {
        profileCount: definitions.length,
        profilesWithoutSkills: definitions
          .filter(
            (definition) =>
              !Array.isArray(definition.assigned_skills) ||
              definition.assigned_skills.length === 0,
          )
          .map((definition) => definition.name)
          .sort((a, b) => a.localeCompare(b)),
      },
    };
  }

  private parseAgentProfileSeed(
    seedRoot: string,
    directoryName: string,
    legacyAssignments: Map<string, string[]>,
    knownSkillNames: Set<string>,
  ): ParsedAgentProfileSeed | null {
    const seedFilePaths = resolveSeedFilePaths({
      seedRoot,
      directoryName,
      agentConfigFile: AGENT_CONFIG_FILE,
      agentPromptFile: AGENT_PROMPT_FILE,
      warn: this.warn,
    });
    if (!seedFilePaths) {
      return null;
    }

    const parsedConfig = this.parseAgentConfig(
      seedFilePaths.configPath,
      directoryName,
    );
    if (!parsedConfig) {
      return null;
    }

    const coreConfig = this.parseCoreSeedConfig(parsedConfig, directoryName);
    if (!coreConfig) {
      return null;
    }

    const mountAliasConfig = resolveParsedMountAliasConfig(
      parsedConfig,
      coreConfig.name,
      (raw, profileName, fieldName) =>
        this.parseOptionalMountAliases(raw, profileName, fieldName),
    );
    if (!mountAliasConfig) {
      return null;
    }

    const assignedSkillsResult = parseSeedAssignedSkills({
      raw: parsedConfig.assigned_skills,
      profileName: coreConfig.name,
      legacyAssignments,
      knownSkillNames,
      skillNamePattern: SKILL_NAME_PATTERN,
      warn: this.warn,
    });
    if (!assignedSkillsResult) {
      return null;
    }

    const isActive = parseSeedIsActive({
      raw: parsedConfig.is_active,
      profileName: coreConfig.name,
      warn: this.warn,
    });
    if (isActive === null) {
      return null;
    }

    const systemPrompt = readSeedSystemPrompt(seedFilePaths.promptPath);
    if (!systemPrompt) {
      this.logger.warn(
        `Skipping agent seed ${coreConfig.name}: ${AGENT_PROMPT_FILE} is empty`,
      );
      return null;
    }

    const definition = buildProfileSeedDefinition({
      ...coreConfig,
      ...mountAliasConfig,
      systemPrompt,
      assignedSkills: assignedSkillsResult.assignedSkills,
      isActive,
    });

    return {
      definition,
      usedLegacyAssignments: assignedSkillsResult.usedLegacyAssignments,
    };
  }

  private parseCoreSeedConfig(
    parsedConfig: AgentSeedConfigFile,
    directoryName: string,
  ): ParsedCoreSeedConfig | null {
    const name = parseSeedAgentName({
      raw: parsedConfig.name,
      directoryName,
      agentConfigFile: AGENT_CONFIG_FILE,
      warn: this.warn,
    });
    if (!name) {
      return null;
    }

    const tierPreference = parseSeedTierPreference({
      raw: parsedConfig.tier_preference,
      profileName: name,
      warn: this.warn,
    });
    if (!tierPreference) {
      return null;
    }

    const toolPolicy = this.parseToolPolicy(parsedConfig.tool_policy, name);
    if (toolPolicy === null || toolPolicy === undefined) {
      this.logger.warn(
        `Skipping agent seed ${name}: tool_policy is missing or invalid`,
      );
      return null;
    }

    const supportsVision = this.parseOptionalBoolean(
      parsedConfig.supports_vision,
      name,
      'supports_vision',
    );
    if (supportsVision === null) {
      return null;
    }

    const modelName = this.parseOptionalModelOrProviderName(
      parsedConfig.model_name,
      name,
      'model_name',
    );
    const providerName = this.parseOptionalModelOrProviderName(
      parsedConfig.provider_name,
      name,
      'provider_name',
    );
    const providerId = this.parseOptionalProviderId(
      parsedConfig.provider_id,
      name,
    );
    const providerSource = this.parseOptionalProviderSource(
      parsedConfig.provider_source,
      name,
    );

    return {
      name,
      tierPreference,
      supportsVision,
      modelName,
      providerName,
      providerId,
      providerSource,
      toolPolicy,
    };
  }

  private parseAgentConfig(
    configPath: string,
    directoryName: string,
  ): AgentSeedConfigFile | null {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          `Skipping agent seed ${directoryName}: ${AGENT_CONFIG_FILE} must contain a JSON object`,
        );
        return null;
      }

      return parsed;
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Skipping agent seed ${directoryName}: failed to parse ${AGENT_CONFIG_FILE} (${err.message})`,
      );
      return null;
    }
  }

  private parseOptionalMountAliases(
    raw: unknown,
    profileName: string,
    fieldName: string,
  ): string[] | undefined | null {
    if (raw === undefined) {
      return undefined;
    }

    return parseSeedStringList({
      raw,
      profileName,
      fieldName,
      warn: this.warn,
    });
  }

  private parseToolPolicy(
    raw: unknown,
    profileName: string,
  ): ParsedCoreSeedConfig['toolPolicy'] | null {
    if (raw === undefined) {
      return undefined;
    }

    if (!isToolPolicyDocument(raw)) {
      this.logger.warn(
        `Skipping agent seed ${profileName}: tool_policy must define a valid default effect and rules array`,
      );
      return null;
    }

    return raw;
  }

  private parseOptionalBoolean(
    raw: unknown,
    profileName: string,
    fieldName: string,
  ): boolean | undefined | null {
    if (raw === undefined) {
      return undefined;
    }

    if (typeof raw !== 'boolean') {
      this.logger.warn(
        `Skipping agent seed ${profileName}: ${fieldName} must be a boolean when provided`,
      );
      return null;
    }

    return raw;
  }

  private parseOptionalModelOrProviderName(
    raw: unknown,
    profileName: string,
    fieldName: string,
  ): string | null | undefined {
    if (raw === undefined) {
      return undefined;
    }

    if (raw === null) {
      return null;
    }

    if (typeof raw !== 'string' || !raw.trim()) {
      this.logger.warn(
        `Skipping agent seed ${profileName}: ${fieldName} must be a non-empty string or null`,
      );
      return undefined;
    }

    return raw.trim();
  }

  private parseOptionalProviderId(
    raw: unknown,
    profileName: string,
  ): string | null | undefined {
    if (raw === undefined) {
      return undefined;
    }

    if (raw === null) {
      return null;
    }

    if (typeof raw !== 'string' || !raw.trim()) {
      this.logger.warn(
        `Skipping agent seed ${profileName}: provider_id must be a non-empty string or null`,
      );
      return undefined;
    }

    return raw.trim();
  }

  private parseOptionalProviderSource(
    raw: unknown,
    profileName: string,
  ): 'global' | 'user' | 'scope' | null | undefined {
    if (raw === undefined) {
      return undefined;
    }

    if (raw === null) {
      return null;
    }

    if (typeof raw !== 'string' || !raw.trim()) {
      this.logger.warn(
        `Skipping agent seed ${profileName}: provider_source must be a non-empty string or null`,
      );
      return undefined;
    }

    const trimmed = raw.trim();

    if (!['global', 'user', 'scope'].includes(trimmed)) {
      this.logger.warn(
        `Skipping agent seed ${profileName}: provider_source must be one of global, user, scope, or null`,
      );
      return undefined;
    }

    return trimmed as 'global' | 'user' | 'scope';
  }

  private loadLegacyAssignments(): Map<string, string[]> {
    const assignmentsPath = resolveLegacyAssignmentsPath(
      this.configuredAssignmentsPath,
      LEGACY_ASSIGNMENTS_FILE,
    );
    if (!assignmentsPath || !fs.existsSync(assignmentsPath)) {
      return new Map<string, string[]>();
    }

    try {
      const raw = fs.readFileSync(assignmentsPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          `Ignoring legacy agent skill assignments: ${LEGACY_ASSIGNMENTS_FILE} must contain a JSON object`,
        );
        return new Map<string, string[]>();
      }

      return parseLegacyAssignments({
        assignments: parsed as LegacyAssignmentsSeed,
        skillNamePattern: SKILL_NAME_PATTERN,
        warn: this.warn,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Ignoring legacy agent skill assignments: failed to parse ${LEGACY_ASSIGNMENTS_FILE} (${err.message})`,
      );
      return new Map<string, string[]>();
    }
  }
}
