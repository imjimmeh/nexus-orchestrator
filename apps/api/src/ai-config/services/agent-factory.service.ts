import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ToolPolicyEffect } from '@nexus/core';
import { CapabilityRegistryService } from '../../capability-infra/capability-registry.service';
import { AgentProfile } from '../database/entities/agent-profile.entity';
import { AgentProfilesFileSeedService } from '../../database/seeds/agent-profiles';
import { AgentProfileRepository } from '../database/repositories/agent-profile.repository';
import { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import { LlmModelRepository } from '../database/repositories/llm-model.repository';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { IAMPolicyService } from '../../security/iam-policy.service';

const PROFILE_NAME_MAX_LENGTH = 64;
const SYSTEM_PROMPT_MAX_LENGTH = 12000;
const PROFILE_NAME_PATTERN = /[^a-z0-9_-]+/g;
const PROTECTED_PROFILE_PREFIXES = [
  'seed-',
  'seed_',
  'system-',
  'system_',
  'admin-',
  'admin_',
  'nexus-',
  'nexus_',
] as const;
const VALID_TIER_PREFERENCES = new Set(['light', 'heavy']);

type CreateFactoryAgentProfileInput = {
  name: string;
  system_prompt?: string;
  tier_preference?: string;
  allowed_tools: string[];
  model_name?: string;
  provider_name?: string;
  supports_vision?: boolean;
  created_by_profile?: string | null;
  created_by_workflow_run_id?: string | null;
  factory_context?: Record<string, unknown> | null;
};

type FactoryEventContext = {
  normalizedName: string;
  createdByProfile: string | null;
  workflowRunId: string | null;
};

type ValidatedFactoryInput = {
  allowedTools: string[];
  systemPrompt: string | undefined;
  tierPreference: string | undefined;
  supportsVision: boolean;
  modelName: string | null;
  providerName: string | null;
  factoryContext: Record<string, unknown> | null;
};

@Injectable()
export class AgentFactoryService {
  private readonly reservedSeededProfileNames: ReadonlySet<string>;

  constructor(
    private readonly profiles: AgentProfileRepository,
    private readonly toolRegistry: ToolRegistryRepository,
    private readonly modelRepository: LlmModelRepository,
    private readonly providerRepository: LlmProviderRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly fileSeedService: AgentProfilesFileSeedService,
    private readonly iamPolicyService: IAMPolicyService,
    private readonly capabilityRegistry: CapabilityRegistryService,
  ) {
    const { definitions } = this.fileSeedService.loadDefinitions();
    this.reservedSeededProfileNames = new Set(
      definitions.map((profile) => profile.name.toLowerCase()),
    );
  }

  async createProfile(
    input: CreateFactoryAgentProfileInput,
  ): Promise<AgentProfile> {
    const context = this.buildEventContext(input);
    await this.emitAttempt(context);

    try {
      const validated = await this.validateInput(input, context.normalizedName);
      const created = await this.profiles.create({
        name: context.normalizedName,
        system_prompt: validated.systemPrompt ?? null,
        tier_preference: validated.tierPreference ?? null,
        supports_vision: validated.supportsVision,
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: validated.allowedTools.map((tool) => ({
            effect: ToolPolicyEffect.ALLOW,
            tool,
          })),
        },
        model_name: validated.modelName,
        provider_name: validated.providerName,
        is_active: true,
        source: 'agent_factory',
        created_by_profile: context.createdByProfile,
        created_by_workflow_run_id: context.workflowRunId,
        factory_context: validated.factoryContext,
      });

      await this.iamPolicyService.refreshPolicies();

      await this.emitSuccess(context, created, validated.allowedTools.length);
      return created;
    } catch (error) {
      await this.emitError(context, error);
      throw error;
    }
  }

  private buildEventContext(
    input: CreateFactoryAgentProfileInput,
  ): FactoryEventContext {
    return {
      normalizedName: this.normalizeProfileName(input.name),
      createdByProfile: this.toNullableString(input.created_by_profile),
      workflowRunId: this.toNullableString(input.created_by_workflow_run_id),
    };
  }

  private async validateInput(
    input: CreateFactoryAgentProfileInput,
    normalizedName: string,
  ): Promise<ValidatedFactoryInput> {
    this.assertReservedNameRules(normalizedName);
    await this.assertNoDuplicateName(normalizedName);

    const allowedTools = await this.validateAllowedTools(input.allowed_tools);
    const model = await this.validateModel(input.model_name);
    const provider = await this.validateProvider(input.provider_name);
    const modelName = this.resolveModelName(model);
    const providerName = this.resolveProviderName(provider, model);

    this.assertModelProviderCompatibility({
      modelName,
      modelProviderName: this.resolveModelProviderName(model),
      providerName,
    });

    return {
      allowedTools,
      systemPrompt: this.validateSystemPrompt(input.system_prompt),
      tierPreference: this.validateTierPreference(input.tier_preference),
      supportsVision: input.supports_vision ?? false,
      modelName,
      providerName,
      factoryContext: this.validateFactoryContext(input.factory_context),
    };
  }

  private async assertNoDuplicateName(normalizedName: string): Promise<void> {
    const duplicate = await this.profiles.findByNameInsensitive(normalizedName);
    if (duplicate) {
      throw new ConflictException(
        `Agent profile "${normalizedName}" already exists`,
      );
    }
  }

  private assertModelProviderCompatibility(params: {
    modelName: string | null;
    modelProviderName: string | null;
    providerName: string | null;
  }): void {
    if (
      params.modelName &&
      params.modelProviderName &&
      params.providerName &&
      params.modelProviderName !== params.providerName
    ) {
      throw new BadRequestException(
        `Model "${params.modelName}" belongs to provider "${params.modelProviderName}", which does not match requested provider "${params.providerName}"`,
      );
    }
  }

  private resolveModelName(
    model: { name?: string | null } | null,
  ): string | null {
    return model?.name ?? null;
  }

  private resolveModelProviderName(
    model: { provider_name?: string | null } | null,
  ): string | null {
    return model?.provider_name ?? null;
  }

  private resolveProviderName(
    provider: { name?: string | null } | null,
    model: { provider_name?: string | null } | null,
  ): string | null {
    return provider?.name ?? model?.provider_name ?? null;
  }

  private async emitAttempt(context: FactoryEventContext): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'agent_profile',
      eventName: 'agent.factory.create.attempted',
      outcome: 'in_progress',
      actorType: context.createdByProfile ? 'agent' : 'system',
      actorId: context.createdByProfile ?? undefined,
      workflowRunId: context.workflowRunId ?? undefined,
      toolName: 'create_agent_profile',
      payload: { profile_name: context.normalizedName },
    });
  }

  private async emitSuccess(
    context: FactoryEventContext,
    profile: AgentProfile,
    allowedToolCount: number,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'agent_profile',
      eventName: 'agent.factory.create.succeeded',
      outcome: 'success',
      actorType: context.createdByProfile ? 'agent' : 'system',
      actorId: context.createdByProfile ?? undefined,
      workflowRunId: context.workflowRunId ?? undefined,
      toolName: 'create_agent_profile',
      payload: {
        profile_id: profile.id,
        profile_name: profile.name,
        allowed_tool_count: allowedToolCount,
      },
    });
  }

  private async emitError(
    context: FactoryEventContext,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const denied =
      error instanceof BadRequestException ||
      error instanceof ConflictException;
    const errorCode = this.resolveFactoryErrorCode(error, denied);

    await this.eventLedger.emitBestEffort({
      domain: 'agent_profile',
      eventName: denied
        ? 'agent.factory.create.denied'
        : 'agent.factory.create.failed',
      outcome: denied ? 'denied' : 'failure',
      actorType: context.createdByProfile ? 'agent' : 'system',
      actorId: context.createdByProfile ?? undefined,
      workflowRunId: context.workflowRunId ?? undefined,
      toolName: 'create_agent_profile',
      errorCode,
      errorMessage: message,
      payload: { profile_name: context.normalizedName },
    });
  }

  private resolveFactoryErrorCode(error: unknown, denied: boolean): string {
    if (!denied) {
      return 'unexpected_error';
    }

    if (error instanceof ConflictException) {
      return 'duplicate_profile_name';
    }

    return 'validation_error';
  }

  private normalizeProfileName(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('profile_name is required');
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .replaceAll(PROFILE_NAME_PATTERN, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^[-_]+|[-_]+$/g, '');

    if (!normalized) {
      throw new BadRequestException(
        'profile_name must normalize to a non-empty value',
      );
    }

    if (normalized.length > PROFILE_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `profile_name must be at most ${PROFILE_NAME_MAX_LENGTH} characters after normalization`,
      );
    }

    return normalized;
  }

  private assertReservedNameRules(normalizedName: string): void {
    if (this.reservedSeededProfileNames.has(normalizedName)) {
      throw new BadRequestException(
        `profile_name "${normalizedName}" is reserved for seeded profiles`,
      );
    }

    if (
      PROTECTED_PROFILE_PREFIXES.some((prefix) =>
        normalizedName.startsWith(prefix),
      )
    ) {
      throw new BadRequestException(
        `profile_name "${normalizedName}" uses a protected prefix`,
      );
    }
  }

  private async validateAllowedTools(raw: unknown): Promise<string[]> {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException('allowed_tools must be a non-empty array');
    }

    const normalized = Array.from(
      new Set(
        raw
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    );

    if (normalized.length === 0) {
      throw new BadRequestException(
        'allowed_tools must contain at least one non-empty tool name',
      );
    }

    if (normalized.includes('*')) {
      throw new BadRequestException(
        'allowed_tools wildcard "*" is not allowed for factory-created profiles',
      );
    }

    const knownTools = await this.resolveKnownToolNames();
    const unknownTools = normalized.filter((tool) => !knownTools.has(tool));
    if (unknownTools.length > 0) {
      throw new BadRequestException(
        `allowed_tools contains unknown tools: ${unknownTools.join(', ')}`,
      );
    }

    return normalized;
  }

  private async resolveKnownToolNames(): Promise<Set<string>> {
    const registryTools = await this.toolRegistry.findAll();
    const names = new Set<string>(
      this.capabilityRegistry.getDiscoveredEntries().map((entry) => entry.name),
    );
    for (const tool of registryTools) {
      names.add(tool.name);
    }
    return names;
  }

  private validateSystemPrompt(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('system_prompt must be a string');
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('system_prompt cannot be empty');
    }

    if (trimmed.length > SYSTEM_PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `system_prompt must be at most ${SYSTEM_PROMPT_MAX_LENGTH} characters`,
      );
    }

    return trimmed;
  }

  private validateTierPreference(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('tier_preference must be a string');
    }

    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (!VALID_TIER_PREFERENCES.has(normalized)) {
      throw new BadRequestException(
        'tier_preference must be either "light" or "heavy"',
      );
    }

    return normalized;
  }

  private async validateModel(value: unknown) {
    const modelName = this.toNullableString(value);
    if (!modelName) {
      return null;
    }

    const model = await this.modelRepository.findByName(modelName);
    if (!model) {
      throw new BadRequestException(`Unknown or inactive model "${modelName}"`);
    }

    return model;
  }

  private async validateProvider(value: unknown) {
    const providerName = this.toNullableString(value);
    if (!providerName) {
      return null;
    }

    const provider = await this.providerRepository.findByName(providerName);
    if (!provider) {
      throw new BadRequestException(
        `Unknown or inactive provider "${providerName}"`,
      );
    }

    return provider;
  }

  private validateFactoryContext(
    value: unknown,
  ): Record<string, unknown> | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('factory_context must be an object');
    }

    return value as Record<string, unknown>;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
