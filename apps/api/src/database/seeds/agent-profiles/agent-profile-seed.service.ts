import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AgentProfile } from '../../../ai-config/database/entities/agent-profile.entity';
import { AgentProfilesFileSeedService } from './agent-profiles-file-seed.service';
import { AgentProfileSkillAssignmentResolverService } from './agent-profile-skill-assignment-resolver.service';
import {
  type NormalizedProfileSeedDefinition,
  type OptionalProfileArrayField,
  OPTIONAL_PROFILE_ARRAY_FIELDS,
} from './agent-profile-seed.types';
import type { ConfigResolutionCache } from '../../../config-resolution/config-resolution-cache.service';
import {
  parseRequiredString,
  parseTierPreference,
  parseOptionalIsActive,
  parseOptionalBoolean,
  parseOptionalModelOrProviderName,
  parseProviderSource,
  parseOptionalStringArray,
} from './agent-profile-seed.parsers';

@Injectable()
export class AgentProfileSeedService {
  private readonly logger = new Logger(AgentProfileSeedService.name);

  constructor(
    @InjectRepository(AgentProfile)
    private readonly repository: Repository<AgentProfile>,
    private readonly fileSeedService: AgentProfilesFileSeedService,
    private readonly skillResolver: AgentProfileSkillAssignmentResolverService,
    @Optional()
    private readonly configResolutionCache?: ConfigResolutionCache,
  ) {}

  async seed(): Promise<void> {
    const fileSeedResult = this.fileSeedService.loadDefinitions();
    const definitions = fileSeedResult.definitions;

    if (definitions.length === 0) {
      this.logger.warn(
        'No file-based agent profile seed definitions were found. Skipping agent profile seeding. Configure seed/agents/<agent-name>/agent.json.',
      );
      return;
    }

    this.logger.log(
      `Using file-based agent profile seeds from ${fileSeedResult.seedRoot ?? 'unknown'} (${definitions.length.toString()} profiles).`,
    );

    if (fileSeedResult.usedLegacyAssignments) {
      this.logger.warn(
        'Some file-based agent seeds omitted assigned_skills and used legacy skill-assignments.seed.json fallback. Add assigned_skills to agent.json files and remove the legacy assignment manifest.',
      );
    }

    for (const definition of definitions) {
      const profile = this.normalizeSeedDefinition(definition);
      if (!profile) {
        continue;
      }

      await this.seedProfile(profile);
    }
  }

  private async seedProfile(
    profileData: NormalizedProfileSeedDefinition,
  ): Promise<void> {
    // Scope lookup to platform defaults: seeded rows with no scope override
    const existing = await this.repository.findOne({
      where: {
        name: profileData.name,
        source: 'seeded',
        scope_node_id: IsNull(),
      },
    });

    const fullData = this.buildFullProfileData(profileData, existing);

    if (!existing) {
      await this.repository.save(this.repository.create(fullData));
      this.configResolutionCache?.invalidate('agent_profile', profileData.name);
      this.logger.log(`Created agent profile: ${profileData.name}`);
      return;
    }

    const skipReason = this.shouldSkipReseed(existing, profileData.name);
    if (skipReason) {
      this.logger.log(skipReason);
      return;
    }

    if (!this.hasChanged(existing, fullData)) {
      return;
    }

    const updated = this.repository.merge(existing, fullData);
    await this.repository.save(updated);
    this.configResolutionCache?.invalidate('agent_profile', profileData.name);
    this.logger.log(`Updated agent profile: ${profileData.name}`);
  }

  private buildFullProfileData(
    profileData: NormalizedProfileSeedDefinition,
    existing: AgentProfile | null,
  ): Partial<AgentProfile> & { name: string } {
    const configuredAssignedSkills = Array.isArray(profileData.assigned_skills)
      ? profileData.assigned_skills
      : undefined;

    const fullData: Partial<AgentProfile> & { name: string } = {
      name: profileData.name,
      system_prompt: profileData.system_prompt,
      tier_preference: profileData.tier_preference,
      allowed_mount_aliases: profileData.allowed_mount_aliases,
      denied_mount_aliases: profileData.denied_mount_aliases,
      allow_rw_mount_aliases: profileData.allow_rw_mount_aliases,
      source: 'seeded',
      created_by_profile: null,
      created_by_workflow_run_id: null,
      factory_context: null,
      tool_policy: profileData.tool_policy ?? null,
      is_active: profileData.is_active ?? true,
      supports_vision: profileData.supports_vision ?? false,
      assigned_skills: this.resolveAssignedSkills(
        profileData.name,
        configuredAssignedSkills,
        existing?.assigned_skills,
      ),
    };

    // Agent profiles only carry an explicit model/provider when the seed
    // definition sets one. Both an omitted (undefined) and an explicit `null`
    // field stay null so the profile inherits the scoped/DB default at runtime
    // — changing the default model then governs every profile that has not
    // opted out, instead of baking the boot-time default into each row.
    fullData.model_name = profileData.model_name ?? null;
    fullData.provider_name = profileData.provider_name ?? null;

    if (profileData.provider_id !== undefined) {
      fullData.provider_id = profileData.provider_id;
    }
    if (profileData.provider_source !== undefined) {
      fullData.provider_source = profileData.provider_source;
    }

    return fullData;
  }

  private shouldSkipReseed(
    existing: AgentProfile,
    profileName: string,
  ): string | null {
    if (existing.locked) {
      return `Agent profile "${profileName}" is locked, skipping reseed`;
    }
    if (existing.overrides !== null && existing.overrides !== undefined) {
      return `Agent profile "${profileName}" has admin overrides, skipping reseed`;
    }
    return null;
  }

  private hasChanged(
    existing: AgentProfile,
    fullData: Partial<AgentProfile> & { name: string },
  ): boolean {
    if (this.hasBaseFieldsChanged(existing, fullData)) {
      return true;
    }
    return !this.skillResolver.areSkillAssignmentsEqual(
      existing.assigned_skills,
      fullData.assigned_skills,
    );
  }

  private hasBaseFieldsChanged(
    existing: AgentProfile,
    fullData: Partial<AgentProfile> & { name: string },
  ): boolean {
    const hasPromptChanged = existing.system_prompt !== fullData.system_prompt;
    const hasModelChanged = existing.model_name !== fullData.model_name;
    const hasProviderChanged =
      existing.provider_name !== fullData.provider_name;
    const hasProviderIdChanged =
      (existing.provider_id ?? null) !== (fullData.provider_id ?? null);
    const hasProviderSourceChanged =
      (existing.provider_source ?? null) !== (fullData.provider_source ?? null);
    const hasTierChanged =
      existing.tier_preference !== fullData.tier_preference;
    const hasAllowedMountAliasesChanged =
      this.stringifyTools(existing.allowed_mount_aliases) !==
      this.stringifyTools(fullData.allowed_mount_aliases);
    const hasDeniedMountAliasesChanged =
      this.stringifyTools(existing.denied_mount_aliases) !==
      this.stringifyTools(fullData.denied_mount_aliases);
    const hasAllowRwMountAliasesChanged =
      this.stringifyTools(existing.allow_rw_mount_aliases) !==
      this.stringifyTools(fullData.allow_rw_mount_aliases);
    const hasCreatorProfileChanged =
      existing.created_by_profile !== fullData.created_by_profile;
    const hasWorkflowRunChanged =
      existing.created_by_workflow_run_id !==
      fullData.created_by_workflow_run_id;
    const hasFactoryContextChanged =
      this.stringifyFactoryContext(existing.factory_context) !==
      this.stringifyFactoryContext(fullData.factory_context);
    const hasToolPolicyChanged =
      this.stringifyPolicy(existing.tool_policy) !==
      this.stringifyPolicy(fullData.tool_policy);

    return [
      hasPromptChanged,
      hasModelChanged,
      hasProviderChanged,
      hasProviderIdChanged,
      hasProviderSourceChanged,
      hasTierChanged,
      hasAllowedMountAliasesChanged,
      hasDeniedMountAliasesChanged,
      hasAllowRwMountAliasesChanged,
      existing.source !== fullData.source,
      hasCreatorProfileChanged,
      hasWorkflowRunChanged,
      hasFactoryContextChanged,
      hasToolPolicyChanged,
      existing.is_active !== fullData.is_active,
      (existing.supports_vision ?? false) !==
        (fullData.supports_vision ?? false),
    ].some(Boolean);
  }

  private stringifyTools(tools: string[] | null | undefined): string {
    return (tools || []).join(',');
  }

  private stringifyFactoryContext(
    value: Record<string, unknown> | null | undefined,
  ): string {
    return value ? JSON.stringify(value) : '';
  }

  private stringifyPolicy(value: unknown): string {
    return value ? JSON.stringify(value) : '';
  }

  private resolveAssignedSkills(
    profileName: string,
    configuredSkills: string[] | undefined,
    existingSkills: string[] | null | undefined,
  ): string[] | null {
    return this.skillResolver.resolveAssignedSkills(
      profileName,
      configuredSkills,
      existingSkills,
    );
  }

  private normalizeSeedDefinition(
    value: unknown,
  ): NormalizedProfileSeedDefinition | null {
    const candidate = this.parseSeedDefinitionRecord(value);
    if (!candidate) {
      return null;
    }

    const normalized = this.parseCoreSeedDefinition(candidate);
    if (!normalized) {
      return null;
    }

    for (const field of OPTIONAL_PROFILE_ARRAY_FIELDS) {
      if (
        !this.assignOptionalStringArrayField(
          candidate,
          normalized,
          normalized.name,
          field,
        )
      ) {
        return null;
      }
    }

    const isActive = parseOptionalIsActive(
      candidate.is_active,
      normalized.name,
      this.logger,
    );
    if (isActive === null) {
      return null;
    }

    if (isActive !== undefined) {
      normalized.is_active = isActive;
    }

    if (candidate.tool_policy !== undefined) {
      normalized.tool_policy =
        candidate.tool_policy as NormalizedProfileSeedDefinition['tool_policy'];
    }

    const supportsVision = parseOptionalBoolean(
      candidate.supports_vision,
      normalized.name,
      'supports_vision',
      this.logger,
    );
    if (supportsVision === null) {
      return null;
    }
    if (supportsVision !== undefined) {
      normalized.supports_vision = supportsVision;
    }

    if (!this.applyModelProviderFields(candidate, normalized)) {
      return null;
    }

    return normalized;
  }

  private applyModelProviderFields(
    candidate: Record<string, unknown>,
    normalized: NormalizedProfileSeedDefinition,
  ): boolean {
    const stringFields = [
      { key: 'model_name', dest: 'model_name' as const },
      { key: 'provider_name', dest: 'provider_name' as const },
      { key: 'provider_id', dest: 'provider_id' as const },
    ] as const;

    for (const { key, dest } of stringFields) {
      const raw = candidate[key];
      const parsed = parseOptionalModelOrProviderName(
        raw,
        normalized.name,
        key,
        this.logger,
      );
      // The parser returns null for an explicit `null` (a valid request to
      // inherit the resolved default) AND for an invalid value it rejected.
      // Only the latter — a non-null value the parser refused — should skip
      // the whole definition. See issue gs65.
      if (parsed === null && raw !== null) {
        return false;
      }
      if (parsed !== undefined) {
        (normalized as Record<string, unknown>)[dest] = parsed;
      }
    }

    const providerSource = parseProviderSource(
      candidate.provider_source,
      normalized.name,
      this.logger,
    );
    if (providerSource === null) {
      return false;
    }
    if (providerSource !== undefined) {
      normalized.provider_source = providerSource;
    }

    return true;
  }

  private assignOptionalStringArrayField(
    candidate: Record<string, unknown>,
    normalized: NormalizedProfileSeedDefinition,
    profileName: string,
    field: OptionalProfileArrayField,
  ): boolean {
    const parsed = parseOptionalStringArray(
      candidate[field],
      `${field} (${profileName})`,
      this.logger,
    );

    if (parsed === null) {
      return false;
    }

    if (parsed) {
      normalized[field] = parsed;
    }

    return true;
  }

  private parseSeedDefinitionRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.logger.warn(
        'Skipping invalid agent profile seed definition: expected object value.',
      );
      return null;
    }

    return value as Record<string, unknown>;
  }

  private parseCoreSeedDefinition(
    candidate: Record<string, unknown>,
  ): NormalizedProfileSeedDefinition | null {
    const name = parseRequiredString(candidate.name, 'name', this.logger);
    if (!name) {
      return null;
    }

    const systemPrompt = parseRequiredString(
      candidate.system_prompt,
      `system_prompt (${name})`,
      this.logger,
    );
    const tierPreference = parseTierPreference(
      candidate.tier_preference,
      name,
      this.logger,
    );

    if (!systemPrompt || !tierPreference) {
      return null;
    }

    return {
      name,
      system_prompt: systemPrompt,
      tier_preference: tierPreference,
    };
  }
}
