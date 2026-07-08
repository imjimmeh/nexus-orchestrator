import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ProviderCrudService,
  ModelCrudService,
  ProfileCrudService,
} from './services/crud';
import { SecretCrudService } from '../security/services/secret-crud.service';
import { ProviderCredentialService } from './services/provider-credential.service';
import type {
  CreateAgentProfileRequest,
  CreateAgentSkillRequest,
  CreateModelRequest,
  CreateProviderRequest,
  CreateSecretRequest,
  ListModelsQuery,
  ListProvidersQuery,
  UpdateAgentProfileRequest,
  UpdateAgentSkillRequest,
  UpdateModelRequest,
  UpdateProviderRequest,
  UpdateSecretRequest,
} from '@nexus/core';
import { AgentSkillsService } from './services/agent-skills.service';
import type { AgentProfile } from './database/entities/agent-profile.entity';
import type { SkillLibraryRecord } from './services/agent-skill-library.service.types';
import { IAMPolicyService } from '../security/iam-policy.service';
import { ThinkingLevelCapabilityService } from './services/thinking-level-capability.service';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { buildPaginatedResponse } from '../common/utils/query-helpers';
import { GitOpsEditPolicyService } from '../gitops/gitops-edit-policy.service';
import { GitOpsPendingChangeService } from '../gitops/gitops-pending-change.service';
import {
  evaluateExistingProfileEdit,
  loadProfileForGitOpsPolicy,
  recordProfilePendingChange,
} from './ai-config-admin-gitops.helpers';
import { emitEmbeddingModelChangedIfNeeded } from './events/embedding-model-change.helpers';
import {
  OAUTH_PRESET_DATA,
  formatProviderName,
} from './ai-config-admin-presets.helpers';
import type { ActiveModelRate } from './ai-config-admin.types';
import { LlmProviderRepository } from './database/repositories/llm-provider.repository';

@Injectable()
export class AiConfigAdminService {
  constructor(
    private readonly providerCrudService: ProviderCrudService,
    private readonly modelCrudService: ModelCrudService,
    private readonly profileCrudService: ProfileCrudService,
    private readonly secretCrudService: SecretCrudService,
    private readonly agentSkillsService: AgentSkillsService,
    private readonly iamPolicyService: IAMPolicyService,
    private readonly toolRegistryRepository: ToolRegistryRepository,
    private readonly providerCredentialService: ProviderCredentialService,
    private readonly eventEmitter: EventEmitter2,
    private readonly thinkingLevelCapability: ThinkingLevelCapabilityService,
    private readonly llmProviderRepository: LlmProviderRepository,
    @Optional()
    private readonly gitOpsEditPolicy?: GitOpsEditPolicyService,
    @Optional()
    private readonly gitOpsPendingChanges?: GitOpsPendingChangeService,
  ) {}

  async listProviders() {
    return this.providerCrudService.findAll();
  }

  async listProvidersPaginated(
    query: Omit<ListProvidersQuery, 'scopeNodeId'> & { scopeIds?: string[] },
  ) {
    const { data, total } =
      await this.providerCrudService.findAllPaginated(query);
    return buildPaginatedResponse(data, total, query.page, query.limit);
  }

  async getProvider(id: string) {
    return this.providerCrudService.findByIdOrThrow(id);
  }

  async createProvider(data: CreateProviderRequest) {
    const prepared = await this.providerCredentialService.applyOnCreate(data);
    return this.providerCrudService.create(prepared);
  }

  async updateProvider(id: string, data: UpdateProviderRequest) {
    const existing = await this.providerCrudService.findById(id);
    const prepared = await this.providerCredentialService.applyOnUpdate(
      data,
      existing,
    );
    const updated = await this.providerCrudService.update(id, prepared);
    if (!updated) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
    return updated;
  }

  async deleteProvider(id: string): Promise<void> {
    return this.providerCrudService.remove(id);
  }

  async listProviderPresets() {
    const { getProviders } = await import('@earendil-works/pi-ai');
    const { getOAuthProviders } = await import('@earendil-works/pi-ai/oauth');
    const presets = [];

    for (const p of getOAuthProviders()) {
      let extra = OAUTH_PRESET_DATA[p.id] ?? {};
      extra = await this.resolveOAuthPresetExtra(p.id, extra);

      const isDeviceFlow = p.login.toString().includes('onDeviceCode');
      presets.push({
        id: p.id,
        name: p.name || formatProviderName(p.id),
        auth_type: 'oauth',
        uses_callback_server: p.usesCallbackServer ?? false,
        is_device_flow: isDeviceFlow,
        ...extra,
      });
    }

    for (const id of getProviders()) {
      if (presets.some((p) => p.id === id)) continue;
      presets.push({
        id,
        name: formatProviderName(id),
        auth_type: 'api_key',
      });
    }

    return { success: true, data: presets };
  }

  async listModelPresets() {
    const { getProviders, getModels } = await import('@earendil-works/pi-ai');
    const allModels = [];

    for (const providerId of getProviders()) {
      try {
        const models = getModels(providerId);
        for (const m of models) {
          allModels.push({
            id: m.id,
            name: m.name,
            provider: m.provider,
            api: m.api,
            baseUrl: m.baseUrl,
            reasoning: m.reasoning,
            input: m.input,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            cost: m.cost,
            thinkingLevelMap: m.thinkingLevelMap,
            supportedThinkingLevels:
              await this.thinkingLevelCapability.getSupportedLevels({
                provider: m.provider,
                modelId: m.id,
                thinkingLevelMap: m.thinkingLevelMap,
              }),
          });
        }
      } catch {
        // Skip providers that fail to load
      }
    }

    return { success: true, data: allModels };
  }

  async listModels() {
    return this.modelCrudService.findAll();
  }

  async getActiveModelRates(): Promise<ActiveModelRate[]> {
    const models = await this.modelCrudService.findAll();
    return models
      .filter((model) => model.is_active)
      .map((model) => ({
        modelId: model.id,
        providerName: model.provider_name ?? null,
        modelName: model.name,
        inputTokenCentsPerMillion: model.input_token_cents_per_million ?? null,
        outputTokenCentsPerMillion:
          model.output_token_cents_per_million ?? null,
      }));
  }

  async listModelsPaginated(query: ListModelsQuery) {
    const { data, total } = await this.modelCrudService.findAllPaginated(query);
    return buildPaginatedResponse(data, total, query.page, query.limit);
  }

  async getModel(id: string) {
    return this.modelCrudService.findByIdOrThrow(id);
  }

  async createModel(data: CreateModelRequest) {
    return this.modelCrudService.create(data);
  }

  async updateModel(id: string, data: UpdateModelRequest) {
    const before = await this.modelCrudService.findById(id);
    const updated = await this.modelCrudService.update(id, data);
    if (!updated) {
      throw new NotFoundException(`Model with ID ${id} not found`);
    }
    // Fire-and-forget: triggers async corpus re-embed; never blocks the response.
    emitEmbeddingModelChangedIfNeeded(this.eventEmitter, before, updated);
    return updated;
  }

  async deleteModel(id: string): Promise<void> {
    return this.modelCrudService.remove(id);
  }

  async listAgentProfiles(scopeIds?: string[]) {
    return this.profileCrudService.findAll(scopeIds ? { scopeIds } : undefined);
  }

  async getAgentProfile(id: string) {
    return this.profileCrudService.findByIdOrThrow(id);
  }

  async createAgentProfile(data: CreateAgentProfileRequest) {
    await this.validateProfileToolNames(data);

    const created = await this.profileCrudService.create({
      name: data.name,
      system_prompt: data.system_prompt,
      model_name: data.model_name,
      provider_name: data.provider_name,
      provider_id: data.provider_id,
      provider_source: data.provider_source,
      tier_preference: data.tier_preference,
      tool_policy: data.tool_policy,
      allowed_mount_aliases: data.allowed_mount_aliases,
      denied_mount_aliases: data.denied_mount_aliases,
      allow_rw_mount_aliases: data.allow_rw_mount_aliases,
      is_active: data.is_active,
      source: 'admin',
      created_by_profile: null,
      created_by_workflow_run_id: null,
      factory_context: null,
    } as CreateAgentProfileRequest);

    await this.iamPolicyService.refreshPolicies();
    return created;
  }

  async updateAgentProfile(
    id: string,
    data: UpdateAgentProfileRequest,
    actorId?: string,
  ) {
    await this.validateProfileToolNames(data);

    const existing = await loadProfileForGitOpsPolicy(
      this.profileCrudService,
      this.gitOpsEditPolicy,
      id,
    );
    const decision = existing
      ? await evaluateExistingProfileEdit(this.gitOpsEditPolicy, existing)
      : undefined;
    const editDecision = decision ?? { action: 'allow' as const };
    this.gitOpsEditPolicy?.assertAllowed(editDecision);

    const updated = await this.profileCrudService.update(id, data);
    if (!updated) {
      throw new NotFoundException(`Agent profile with ID ${id} not found`);
    }

    await this.iamPolicyService.refreshPolicies();
    await this.recordProfilePendingChange(
      editDecision,
      existing,
      data,
      actorId,
      'update',
    );
    return updated;
  }

  async deleteAgentProfile(id: string, actorId?: string): Promise<void> {
    const existing = await loadProfileForGitOpsPolicy(
      this.profileCrudService,
      this.gitOpsEditPolicy,
      id,
    );
    const decision = existing
      ? await evaluateExistingProfileEdit(this.gitOpsEditPolicy, existing)
      : undefined;
    const editDecision = decision ?? { action: 'allow' as const };
    this.gitOpsEditPolicy?.assertAllowed(editDecision);
    await this.profileCrudService.remove(id);
    await this.iamPolicyService.refreshPolicies();
    await this.recordProfilePendingChange(
      editDecision,
      existing,
      { is_active: false },
      actorId,
      'delete',
    );
  }

  async createScopedAgentOverride(
    baseProfileId: string,
    scopeNodeId: string,
    overrides: UpdateAgentProfileRequest,
    actorId?: string,
  ): Promise<AgentProfile> {
    const base = await this.profileCrudService.findByIdOrThrow(baseProfileId);
    const decision = await this.gitOpsEditPolicy?.evaluateCreate({
      objectType: 'agent_profile',
      scopeNodeId,
    });
    if (decision) {
      this.gitOpsEditPolicy?.assertAllowed(decision);
    }
    const {
      id: _id,
      created_at: _created_at,
      updated_at: _updated_at,
      skillAssignments: _skillAssignments,
      ...clonableFields
    } = base as unknown as Record<string, unknown>;
    const created = await this.profileCrudService.create({
      ...clonableFields,
      ...overrides,
      name: base.name,
      scope_node_id: scopeNodeId,
      base_profile_id: base.id,
      source: 'admin',
      locked: false,
    } as CreateAgentProfileRequest);
    await this.iamPolicyService.refreshPolicies();
    await this.recordProfilePendingChange(
      decision ?? { action: 'allow' },
      { scope_node_id: scopeNodeId, name: base.name },
      overrides,
      actorId,
      'create',
    );
    return created;
  }

  async findProfilesByName(name: string): Promise<AgentProfile[]> {
    const all = await this.profileCrudService.findAll();
    return all.filter((p) => p.name === name);
  }

  async getSkillsForAgentProfile(profileId: string) {
    const skills =
      await this.agentSkillsService.listSkillsForProfile(profileId);
    return skills.map((skill) => this.mapSkillToApiShape(skill));
  }

  async replaceSkillsForAgentProfile(profileId: string, skillIds: string[]) {
    const skills = await this.agentSkillsService.replaceProfileSkills(
      profileId,
      skillIds,
    );
    return skills.map((skill) => this.mapSkillToApiShape(skill));
  }

  async addSkillsForAgentProfile(profileId: string, skillIds: string[]) {
    const skills = await this.agentSkillsService.addProfileSkills(
      profileId,
      skillIds,
    );
    return skills.map((skill) => this.mapSkillToApiShape(skill));
  }

  async removeSkillsForAgentProfile(profileId: string, skillIds: string[]) {
    const skills = await this.agentSkillsService.removeProfileSkills(
      profileId,
      skillIds,
    );
    return skills.map((skill) => this.mapSkillToApiShape(skill));
  }

  listAgentSkills(params?: { includeInactive?: boolean }) {
    const skills = this.agentSkillsService.listSkills(params);
    return skills.map((skill) => this.mapSkillToApiShape(skill));
  }

  getAgentSkill(id: string) {
    const skill = this.agentSkillsService.getSkill(id);
    return this.mapSkillToApiShape(skill);
  }

  createAgentSkill(data: CreateAgentSkillRequest) {
    const skill = this.agentSkillsService.createSkill(data);
    return this.mapSkillToApiShape(skill);
  }

  updateAgentSkill(id: string, data: UpdateAgentSkillRequest) {
    const skill = this.agentSkillsService.updateSkill(id, data);
    return this.mapSkillToApiShape(skill);
  }

  async deleteAgentSkill(id: string): Promise<void> {
    return this.agentSkillsService.deleteSkill(id);
  }

  listAgentSkillFiles(id: string) {
    return this.agentSkillsService.listSkillFiles(id);
  }

  upsertAgentSkillFile(params: {
    id: string;
    relativePath: string;
    content: string;
    contentBase64?: string;
  }) {
    return this.agentSkillsService.upsertSkillFile({
      skillId: params.id,
      relativePath: params.relativePath,
      content: params.content,
      contentBase64: params.contentBase64,
    });
  }

  deleteAgentSkillFile(id: string, relativePath: string) {
    return this.agentSkillsService.deleteSkillFile(id, relativePath);
  }

  private mapSkillToApiShape(skill: SkillLibraryRecord) {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      skill_markdown: skill.skillMarkdown,
      compatibility: skill.compatibility,
      metadata: skill.metadata,
      source: skill.source,
      created_by_profile: null,
      created_by_workflow_run_id: null,
      version: skill.version,
      is_active: skill.isActive,
      created_at: skill.createdAt.toISOString(),
      updated_at: skill.updatedAt.toISOString(),
    };
  }

  async listSecrets(scopeIds?: string[]) {
    return this.secretCrudService.findAll(scopeIds ? { scopeIds } : undefined);
  }

  async getSecret(id: string) {
    const secret = await this.secretCrudService.findById(id);
    if (!secret) {
      throw new NotFoundException(`Secret with ID ${id} not found`);
    }
    return secret;
  }

  async createSecret(data: CreateSecretRequest) {
    return this.secretCrudService.create(data);
  }

  async updateSecret(id: string, data: UpdateSecretRequest) {
    const updated = await this.secretCrudService.update(id, data);
    if (!updated) {
      throw new NotFoundException(`Secret with ID ${id} not found`);
    }
    return updated;
  }

  async deleteSecret(id: string): Promise<void> {
    return this.secretCrudService.remove(id);
  }

  private async resolveOAuthPresetExtra(
    providerId: string,
    extra: {
      oauth_authorization_url?: string;
      oauth_token_url?: string;
      oauth_scopes?: string[];
    },
  ): Promise<{
    oauth_authorization_url?: string;
    oauth_token_url?: string;
    oauth_scopes?: string[];
  }> {
    const hasOAuthExtra =
      extra.oauth_authorization_url ||
      extra.oauth_token_url ||
      (extra.oauth_scopes && extra.oauth_scopes.length > 0);

    if (hasOAuthExtra) {
      return extra;
    }

    const provider =
      await this.llmProviderRepository.findByProviderId(providerId);
    if (!provider) {
      return extra;
    }

    return {
      oauth_authorization_url: provider.oauth_authorization_url ?? undefined,
      oauth_token_url: provider.oauth_token_url ?? undefined,
      oauth_scopes: provider.oauth_scopes ?? undefined,
    };
  }

  private async recordProfilePendingChange(
    decision: { action: string; binding?: unknown },
    profile: Record<string, unknown> | null,
    payload: Record<string, unknown>,
    actorId: string | undefined,
    changeType: string,
  ): Promise<void> {
    await recordProfilePendingChange(
      this.gitOpsPendingChanges,
      decision,
      profile,
      payload,
      actorId,
      changeType,
    );
  }

  private async validateProfileToolNames(params: {
    tool_policy?: { rules?: Array<string | { tool?: string }> } | null;
  }): Promise<void> {
    const knownToolNames = await this.resolveKnownToolNames();

    if (params.tool_policy?.rules) {
      const unknownTools: string[] = [];
      for (const rule of params.tool_policy.rules) {
        const toolName = typeof rule === 'string' ? rule : rule.tool;
        if (toolName && toolName !== '*' && !toolName.startsWith('legacy:')) {
          if (!knownToolNames.has(toolName)) {
            unknownTools.push(toolName);
          }
        }
      }
      if (unknownTools.length > 0) {
        throw new BadRequestException({
          message: `tool_policy contains unknown tools`,
          field: 'tool_policy',
          unknownTools,
          hint: 'Use active tool names from tool_registry or mark legacy entries with legacy:<tool_name>.',
        });
      }
    }
  }

  private async resolveKnownToolNames(): Promise<Set<string>> {
    const tools = await this.toolRegistryRepository.findAll();
    return new Set<string>(tools.map((tool) => tool.name));
  }
}
