import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import {
  resolveProviderApiKey,
  resolveProviderBaseUrl,
} from './ai-configuration-env.helpers';
import { AgentProfileRepository } from './database/repositories/agent-profile.repository';
import {
  LlmModelRepository,
  ModelUseCase,
} from './database/repositories/llm-model.repository';
import { LlmProviderRepository } from './database/repositories/llm-provider.repository';
import { SecretStoreRepository } from '../security/database/repositories/secret-store.repository';
import { SecretVaultService } from '../security/secret-vault.service';
import { AgentProfile } from './database/entities/agent-profile.entity';
import type { LlmProvider } from './database/entities/llm-provider.entity';
import { ModelSelectionFactory } from './strategies/model-selection';
import { AgentSkillsService } from './services/agent-skills.service';
import { ProviderReferenceService } from './services/provider-reference.service';
import { ProviderOAuthService } from './services/provider-oauth.service';
import { RunnerProviderSelectionService } from './services/runner-provider-selection.service';
import { FallbackChainResolverService } from './fallback/fallback-chain-resolver.service';

export type {
  ResolvedAgentSettings,
  ResolvedRunnerProviderConfig,
  ResolvedEmbeddingModelConfig,
  ResolveStepSettingsParams,
} from './ai-configuration.service.types';
import type {
  ResolvedAgentSettings,
  ResolvedRunnerProviderConfig,
  ResolvedEmbeddingModelConfig,
  ResolveStepSettingsParams,
} from './ai-configuration.service.types';

@Injectable()
export class AiConfigurationService {
  constructor(
    private readonly agentProfiles: AgentProfileRepository,
    private readonly models: LlmModelRepository,
    private readonly providers: LlmProviderRepository,
    private readonly secrets: SecretStoreRepository,
    private readonly vault: SecretVaultService,
    private readonly modelSelectionFactory: ModelSelectionFactory,
    private readonly agentSkills: AgentSkillsService,
    private readonly providerReference: ProviderReferenceService,
    private readonly providerOAuth: ProviderOAuthService,
    private readonly fallbackResolver: FallbackChainResolverService,
    private readonly runnerProviderSelection: RunnerProviderSelectionService,
  ) {}

  async resolveStepSettings(
    params: ResolveStepSettingsParams,
  ): Promise<ResolvedAgentSettings> {
    const profile = await this.loadProfileByName(params.agentProfileName);
    const model = await this.resolveStepModel(params.explicitModel, profile);
    const systemPrompt = this.resolveStepSystemPrompt(
      params.explicitSystemPrompt,
      profile,
      params.promptMode,
    );
    const providerName = this.resolveStepProviderName(
      params.explicitProviderName,
      profile,
    );

    const primary = { provider_name: providerName ?? '', model_name: model };
    // Only invoke the resolver when a provider is configured; no provider means
    // no chain context and the fallback logic would be meaningless.
    const chosen = providerName
      ? await this.fallbackResolver.resolve(
          {
            primary,
            stepInlineChain: params.stepFallbackChain,
            profileChain: profile?.fallback_chain ?? null,
          },
          new Date(),
        )
      : primary;

    const switched =
      chosen.provider_name !== primary.provider_name ||
      chosen.model_name !== primary.model_name;

    return {
      model: chosen.model_name,
      systemPrompt,
      providerName: chosen.provider_name || undefined,
      providerId: switched ? null : profile?.provider_id,
      providerSource: switched ? null : profile?.provider_source,
    };
  }

  listSkillCategories(skillIds?: string[]): string[] {
    return this.agentSkills.listCategories(skillIds);
  }

  async getAgentProfileByName(name: string): Promise<AgentProfile | null> {
    return this.agentProfiles.findByName(name);
  }

  async getModelDefaultThinkingLevel(
    modelName: string,
  ): Promise<string | null> {
    const model = await this.models.findByName(modelName);
    return model?.default_thinking_level ?? null;
  }

  async getModelByName(name: string) {
    return this.models.findByName(name);
  }

  async getModelForUseCase(useCase: ModelUseCase): Promise<string> {
    return this.modelSelectionFactory.selectModel(useCase);
  }

  async getTokenLimit(modelName: string): Promise<number> {
    const model = await this.models.findByName(modelName);
    if (model?.token_limit) {
      return model.token_limit;
    }
    return 128000;
  }

  async buildProviderEnvByModel(
    modelName: string,
  ): Promise<Record<string, string>> {
    const model = await this.models.findByName(modelName);
    if (!model?.provider_name) {
      return {};
    }
    return this.buildProviderEnvByName(model.provider_name);
  }

  async buildProviderEnvByName(
    providerName: string,
  ): Promise<Record<string, string>> {
    const provider = await this.providers.findByName(providerName);
    if (!provider) {
      return {};
    }

    const secretMap = await this.resolveSecretMap(
      provider.secret_id ?? undefined,
    );
    const runtimeEnv = provider.runtime_env || {};
    return this.buildStringEnv({
      ...runtimeEnv,
      ...secretMap,
    });
  }

  private async loadProfileByName(
    agentProfileName?: string,
  ): Promise<AgentProfile | null> {
    if (!agentProfileName) {
      return null;
    }

    return this.agentProfiles.findByName(agentProfileName);
  }

  private async resolveStepModel(
    explicitModel: string | undefined,
    profile: AgentProfile | null,
  ): Promise<string> {
    return (
      explicitModel ||
      profile?.model_name ||
      (await this.getModelForUseCase('execution'))
    );
  }

  private resolveStepSystemPrompt(
    explicitSystemPrompt: string | undefined,
    profile: AgentProfile | null,
    promptMode?: 'override' | 'append',
  ): string {
    if (
      promptMode === 'append' &&
      profile?.system_prompt &&
      explicitSystemPrompt
    ) {
      return `${profile.system_prompt}\n\n${explicitSystemPrompt}`;
    }
    return (
      explicitSystemPrompt || profile?.system_prompt || 'You are a Pi Agent.'
    );
  }

  private resolveStepProviderName(
    explicitProviderName: string | undefined,
    profile: AgentProfile | null,
  ): string | undefined {
    return explicitProviderName || profile?.provider_name || undefined;
  }

  private async resolveSecretMap(
    secretId: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!secretId) {
      return {};
    }

    const secret = await this.secrets.findById(secretId);
    if (!secret) {
      return {};
    }

    return this.parseSecretPayload(secret.encrypted_value);
  }

  private buildStringEnv(
    values: Record<string, unknown>,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!this.isSerializableEnvValue(value)) {
        continue;
      }
      env[key] = String(value);
    }
    return env;
  }

  private isSerializableEnvValue(
    value: unknown,
  ): value is string | number | boolean {
    return (
      value !== null &&
      value !== undefined &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean')
    );
  }

  async resolveRunnerProviderConfig(params: {
    modelName: string;
    providerName?: string;
    providerId?: string;
    providerSource?: 'global' | 'user' | 'scope';
    executionContext?: {
      ownerType: 'global' | 'user' | 'scope';
      ownerId?: string | null;
    };
  }): Promise<ResolvedRunnerProviderConfig> {
    const model = await this.models.findByName(params.modelName);
    const providerName =
      params.providerName || model?.provider_name || undefined;

    const useScopedResolution =
      params.providerId || params.providerSource || params.executionContext;

    if (!providerName && !params.providerId) {
      return this.emptyProviderConfig('openai');
    }

    if (useScopedResolution) {
      return this.resolveViaProviderReference(params, providerName);
    }

    if (!providerName) {
      return this.emptyProviderConfig('openai');
    }

    const provider = await this.providers.findByName(providerName);
    if (!provider) {
      return this.emptyProviderConfig(providerName);
    }

    return this.buildResolvedProviderConfig(provider);
  }

  private async resolveViaProviderReference(
    params: {
      providerId?: string;
      providerSource?: 'global' | 'user' | 'scope';
      executionContext?: {
        ownerType: 'global' | 'user' | 'scope';
        ownerId?: string | null;
      };
    },
    providerName: string | undefined,
  ): Promise<ResolvedRunnerProviderConfig> {
    try {
      const provider = await this.providerReference.resolve({
        providerId: params.providerId,
        providerSource: params.providerSource,
        providerName: providerName ?? undefined,
        executionContext: params.executionContext,
      });

      return await this.buildResolvedProviderConfig(provider);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return this.emptyProviderConfig(providerName || 'openai');
      }
      throw error;
    }
  }

  private emptyProviderConfig(provider: string): ResolvedRunnerProviderConfig {
    return {
      provider,
      apiKey: '',
      auth: { type: 'api_key', apiKey: '' },
      providerEnv: {},
    };
  }

  private async buildResolvedProviderConfig(
    provider: LlmProvider,
  ): Promise<ResolvedRunnerProviderConfig> {
    // Refresh an expiring OAuth access token (and persist the rotated credential)
    // before the secret is read, so every harness receives a live token.
    await this.providerOAuth.ensureFreshOAuthCredential(provider);

    const runtimeEnv = provider.runtime_env || {};
    const secretMap = await this.resolveSecretMap(
      provider.secret_id ?? undefined,
    );
    const rawProviderEnv = this.buildStringEnv({
      ...runtimeEnv,
      ...secretMap,
    });
    const providerEnv =
      provider.auth_type === 'oauth'
        ? this.runnerProviderSelection.removeOAuthCredentialEnv(rawProviderEnv)
        : rawProviderEnv;
    const runtimeProviderName = this.asNonEmptyString(runtimeEnv.pi_provider);
    const apiKeyField = this.asNonEmptyString(runtimeEnv.api_key_field);
    const baseUrlField = this.asNonEmptyString(runtimeEnv.base_url_field);

    const resolvedProvider =
      provider.auth_type === 'oauth'
        ? provider.name
        : runtimeProviderName || provider.name;
    const baseUrl = this.normalizeBaseUrl(
      resolveProviderBaseUrl({ providerEnv, baseUrlField }) ||
        this.asNonEmptyString(runtimeEnv.base_url),
    );
    const auth = this.runnerProviderSelection.resolveRunnerProviderAuth({
      provider,
      resolvedProvider,
      providerEnv,
      runtimeEnv,
      secretMap,
      apiKeyField,
      resolveApiKey: resolveProviderApiKey,
    });
    const runtimeEnvWithProviderConfig =
      await this.injectSynthesizedOAuthProviderConfig(
        provider,
        runtimeEnv,
        secretMap,
      );
    const providerConfig =
      this.runnerProviderSelection.resolveProviderRegistrationConfig({
        auth,
        baseUrl,
        runtimeEnv: runtimeEnvWithProviderConfig,
        secretMap,
      });
    const resolvedBaseUrl = this.resolveReturnedBaseUrl(
      baseUrl,
      providerConfig?.baseUrl,
    );

    return {
      provider: resolvedProvider,
      apiKey: auth.type === 'api_key' ? auth.apiKey : '',
      auth,
      baseUrl: resolvedBaseUrl,
      providerConfig,
      providerEnv,
    };
  }

  private async injectSynthesizedOAuthProviderConfig(
    provider: LlmProvider,
    runtimeEnv: Record<string, unknown>,
    secretMap: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (provider.auth_type !== 'oauth') {
      return runtimeEnv;
    }

    const hasExplicitConfig =
      this.isRecord(runtimeEnv.providerConfig) ||
      this.isRecord(runtimeEnv.provider_config) ||
      this.isRecord(secretMap.providerConfig) ||
      this.isRecord(secretMap.provider_config);

    if (hasExplicitConfig) {
      return runtimeEnv;
    }

    const synthesized = await this.synthesizeOAuthProviderConfig(provider);
    if (!synthesized) {
      return runtimeEnv;
    }

    return { ...runtimeEnv, providerConfig: synthesized };
  }

  private async synthesizeOAuthProviderConfig(provider: LlmProvider) {
    const runtimeEnv = provider.runtime_env || {};
    const piProvider = this.asNonEmptyString(runtimeEnv.pi_provider);
    const tokenUrl = this.asNonEmptyString(provider.oauth_token_url);

    if (!piProvider || !tokenUrl) {
      return undefined;
    }

    return await this.runnerProviderSelection.synthesizeOAuthProviderConfig({
      providerName: provider.name,
      piProvider,
      oauthTokenUrl: tokenUrl,
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private resolveReturnedBaseUrl(
    baseUrl: string | undefined,
    providerConfigBaseUrl: string | undefined,
  ): string | undefined {
    return baseUrl ?? providerConfigBaseUrl;
  }

  private parseSecretPayload(encryptedValue: string): Record<string, unknown> {
    try {
      const decrypted = this.vault.decrypt(encryptedValue);
      return JSON.parse(decrypted) as Record<string, unknown>;
    } catch {
      return JSON.parse(encryptedValue) as Record<string, unknown>;
    }
  }

  private asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    return value.replaceAll(/\/+$/g, '');
  }

  async resolveEmbeddingModelConfig(): Promise<ResolvedEmbeddingModelConfig> {
    const model = await this.models.findDefaultForEmbedding();
    if (!model) {
      return { configured: false };
    }

    const providerName = model.provider_name ?? undefined;
    if (!providerName) {
      return { configured: false };
    }

    const provider = await this.providers.findByName(providerName);
    if (!provider) {
      return { configured: false };
    }

    try {
      const providerConfig = await this.resolveRunnerProviderConfig({
        modelName: model.name,
        providerName,
      });

      return {
        configured: true,
        modelId: model.id,
        modelName: model.name,
        provider: providerConfig.provider,
        auth: providerConfig.auth,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        embeddingDimension: model.embedding_dimension ?? null,
        providerEnv: providerConfig.providerEnv,
      };
    } catch {
      return { configured: false };
    }
  }
}
