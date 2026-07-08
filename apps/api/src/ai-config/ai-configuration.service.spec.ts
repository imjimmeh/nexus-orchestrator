import { vi, describe, it, beforeEach, expect, type Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiConfigurationService } from './ai-configuration.service';
import { AgentProfileRepository } from './database/repositories/agent-profile.repository';
import { LlmModelRepository } from './database/repositories/llm-model.repository';
import { LlmProviderRepository } from './database/repositories/llm-provider.repository';
import { SecretStoreRepository } from '../security/database/repositories/secret-store.repository';
import { SecretVaultService } from '../security/secret-vault.service';
import { AgentProfile } from './database/entities/agent-profile.entity';
import { LlmModel } from './database/entities/llm-model.entity';
import { LlmProvider } from './database/entities/llm-provider.entity';
import { SecretStore } from '../security/database/entities/secret-store.entity';
import {
  DatabaseModelStrategy,
  EnvironmentModelStrategy,
  ModelSelectionFactory,
} from './strategies/model-selection';
import { AgentSkillsService } from './services/agent-skills.service';
import { ProviderReferenceService } from './services/provider-reference.service';
import { ProviderOAuthService } from './services/provider-oauth.service';
import { RunnerProviderSelectionService } from './services/runner-provider-selection.service';
import { NotFoundException } from '@nestjs/common';
import { FallbackChainResolverService } from './fallback/fallback-chain-resolver.service';
import type { RunnerProviderRegistrationConfig } from '@nexus/core';

type MockAgentProfiles = {
  findByName: Mock;
};

type MockFallbackResolver = {
  resolve: Mock;
};

type MockModels = {
  findDefaultForUseCase: Mock;
  findByName: Mock;
};

type MockProviders = {
  findByName: Mock;
  findById: Mock;
  findActiveByOwnerAndName: Mock;
};

type MockSecrets = {
  findById: Mock;
};

type MockVault = {
  decrypt: Mock;
};

type MockAgentSkills = {
  listCategories: Mock;
};

type MockProviderOAuth = {
  ensureFreshOAuthCredential: Mock;
};

type MockRunnerProviderSelection = {
  removeOAuthCredentialEnv: Mock;
  resolveRunnerProviderAuth: Mock;
  resolveProviderRegistrationConfig: Mock;
  synthesizeOAuthProviderConfig: Mock;
};

const FIXTURE_SYNTHESIZED_OAUTH_PROVIDER_CONFIG: RunnerProviderRegistrationConfig =
  {
    name: 'synthesized-fixture',
    baseUrl: 'https://synthesized.example/v1',
    api: 'openai-codex-responses',
    authHeader: true,
  };

describe('AiConfigurationService', () => {
  let service: AiConfigurationService;
  let mockAgentProfiles: MockAgentProfiles;
  let mockModels: MockModels;
  let mockProviders: MockProviders;
  let mockSecrets: MockSecrets;
  let mockVault: MockVault;
  let mockAgentSkills: MockAgentSkills;
  let mockProviderOAuth: MockProviderOAuth;
  let mockFallbackResolver: MockFallbackResolver;
  let mockRunnerProviderSelection: MockRunnerProviderSelection;

  beforeEach(async () => {
    const mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'MODEL') return 'env-model';
        if (key === 'DISTILLATION_MODEL') return 'env-distill';
        if (key === 'SUMMARIZATION_MODEL') return 'env-summary';
        return undefined;
      }),
    };

    mockAgentProfiles = {
      findByName: vi.fn(),
    };

    mockModels = {
      findDefaultForUseCase: vi.fn(),
      findByName: vi.fn(),
    };

    mockProviders = {
      findByName: vi.fn(),
      findById: vi.fn(),
      findActiveByOwnerAndName: vi.fn(),
    };

    mockSecrets = {
      findById: vi.fn(),
    };

    mockVault = {
      decrypt: vi.fn(),
    };

    mockAgentSkills = {
      listCategories: vi.fn(() => []),
    };

    mockProviderOAuth = {
      ensureFreshOAuthCredential: vi.fn(),
    };

    const realRunnerProviderSelection = new RunnerProviderSelectionService();

    mockRunnerProviderSelection = {
      removeOAuthCredentialEnv: vi.fn((providerEnv: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(providerEnv).filter(
            ([key]) =>
              !/(access[_-]?token|refresh[_-]?token|expires[_-]?at|oauth)$/i.test(
                key,
              ),
          ),
        ),
      ),
      resolveRunnerProviderAuth: vi.fn(
        (
          params: Parameters<
            RunnerProviderSelectionService['resolveRunnerProviderAuth']
          >[0],
        ) => realRunnerProviderSelection.resolveRunnerProviderAuth(params),
      ),
      resolveProviderRegistrationConfig: vi.fn(
        (
          params: Parameters<
            RunnerProviderSelectionService['resolveProviderRegistrationConfig']
          >[0],
        ) =>
          realRunnerProviderSelection.resolveProviderRegistrationConfig(params),
      ),
      synthesizeOAuthProviderConfig: vi.fn(async () =>
        structuredClone(FIXTURE_SYNTHESIZED_OAUTH_PROVIDER_CONFIG),
      ),
    };

    // Returns the primary by default — callers override per-test to simulate cooldown.
    mockFallbackResolver = {
      resolve: vi
        .fn()
        .mockImplementation(
          async (params: {
            primary: { provider_name: string; model_name: string };
          }) => params.primary,
        ),
    };

    const mockDatabaseStrategy = {
      priority: 1,
      canSelect: vi.fn().mockReturnValue(true),
      selectModel: vi.fn().mockImplementation(async (useCase: string) => {
        const model = await mockModels.findDefaultForUseCase(useCase);
        return model?.name || null;
      }),
    };

    const mockEnvironmentStrategy = {
      priority: 2,
      canSelect: vi.fn().mockReturnValue(true),
      selectModel: vi.fn().mockImplementation(async (useCase: string) => {
        if (useCase === 'distillation') {
          return (
            mockConfigService.get('DISTILLATION_MODEL') ||
            mockConfigService.get('MODEL') ||
            'default-model'
          );
        }
        if (useCase === 'summarization') {
          return (
            mockConfigService.get('SUMMARIZATION_MODEL') ||
            mockConfigService.get('MODEL') ||
            'default-model'
          );
        }
        return mockConfigService.get('MODEL') || 'default-model';
      }),
    };

    const mockModelSelectionFactory = {
      selectModel: vi.fn().mockImplementation(async (useCase: string) => {
        for (const strategy of [
          mockDatabaseStrategy,
          mockEnvironmentStrategy,
        ]) {
          if (strategy.canSelect(useCase)) {
            const model = await strategy.selectModel(useCase);
            if (model) {
              return model;
            }
          }
        }
        return 'default-model';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiConfigurationService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AgentProfileRepository, useValue: mockAgentProfiles },
        { provide: LlmModelRepository, useValue: mockModels },
        { provide: LlmProviderRepository, useValue: mockProviders },
        { provide: SecretStoreRepository, useValue: mockSecrets },
        { provide: SecretVaultService, useValue: mockVault },
        { provide: DatabaseModelStrategy, useValue: mockDatabaseStrategy },
        {
          provide: EnvironmentModelStrategy,
          useValue: mockEnvironmentStrategy,
        },
        { provide: ModelSelectionFactory, useValue: mockModelSelectionFactory },
        { provide: AgentSkillsService, useValue: mockAgentSkills },
        {
          provide: ProviderReferenceService,
          useClass: ProviderReferenceService,
        },
        { provide: ProviderOAuthService, useValue: mockProviderOAuth },
        {
          provide: FallbackChainResolverService,
          useValue: mockFallbackResolver,
        },
        {
          provide: RunnerProviderSelectionService,
          useValue: mockRunnerProviderSelection,
        },
      ],
    }).compile();

    service = module.get<AiConfigurationService>(AiConfigurationService);
  });

  it('resolves step settings with explicit values taking precedence', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-1',
      name: 'qa_automation',
      model_name: 'profile-model',
      provider_name: 'profile-provider',
      system_prompt: 'profile-prompt',
      tier_preference: 'light',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockModels.findDefaultForUseCase.mockResolvedValue({
      id: 'model-1',
      name: 'db-model',
      provider_name: 'openai',
      token_limit: 128000,
      default_for_execution: true,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: true,
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      explicitModel: 'explicit-model',
      explicitSystemPrompt: 'explicit-prompt',
      explicitProviderName: 'explicit-provider',
      agentProfileName: 'qa_automation',
    });

    expect(resolved).toEqual({
      model: 'explicit-model',
      systemPrompt: 'explicit-prompt',
      providerName: 'explicit-provider',
    });
  });

  it('falls back to environment model when DB default is missing', async () => {
    mockModels.findDefaultForUseCase.mockResolvedValue(null);

    const model = await service.getModelForUseCase('distillation');
    expect(model).toBe('env-distill');
  });

  it('keeps configured provider and model values unchanged', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-legacy-1',
      name: 'testing-agent',
      model_name: 'MiniMaxAI/MiniMax-M2.5-TEE',
      provider_name: 'chutes.ai',
      system_prompt: 'legacy-prompt',
      tier_preference: 'light',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      agentProfileName: 'testing-agent',
    });

    expect(resolved).toEqual({
      model: 'MiniMaxAI/MiniMax-M2.5-TEE',
      systemPrompt: 'legacy-prompt',
      providerName: 'chutes.ai',
    });
  });

  it('appends step prompt to profile system_prompt when promptMode is append', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-arch',
      name: 'architect-agent',
      model_name: 'arch-model',
      provider_name: 'openai',
      system_prompt: 'You are the Nexus Architect Agent.',
      tier_preference: 'heavy',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      explicitSystemPrompt: 'Task: produce SDD for auth module.',
      agentProfileName: 'architect-agent',
      promptMode: 'append',
    });

    expect(resolved.systemPrompt).toBe(
      'You are the Nexus Architect Agent.\n\nTask: produce SDD for auth module.',
    );
  });

  it('uses step prompt when promptMode is append but profile has no system_prompt', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-no-prompt',
      name: 'bare-agent',
      model_name: 'some-model',
      provider_name: null,
      system_prompt: null,
      tier_preference: 'light',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      explicitSystemPrompt: 'Task: do something.',
      agentProfileName: 'bare-agent',
      promptMode: 'append',
    });

    expect(resolved.systemPrompt).toBe('Task: do something.');
  });

  it('uses profile system_prompt when promptMode is append but no step prompt', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-arch-2',
      name: 'architect-agent',
      model_name: 'arch-model',
      provider_name: null,
      system_prompt: 'You are the Nexus Architect Agent.',
      tier_preference: 'heavy',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      agentProfileName: 'architect-agent',
      promptMode: 'append',
    });

    expect(resolved.systemPrompt).toBe('You are the Nexus Architect Agent.');
  });

  it('overrides profile system_prompt when promptMode is not set (default)', async () => {
    mockAgentProfiles.findByName.mockResolvedValue({
      id: 'profile-arch-3',
      name: 'architect-agent',
      model_name: 'arch-model',
      provider_name: null,
      system_prompt: 'You are the Nexus Architect Agent.',
      tier_preference: 'heavy',
      source: 'seeded',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    const resolved = await service.resolveStepSettings({
      explicitSystemPrompt: 'Custom prompt.',
      agentProfileName: 'architect-agent',
    });

    expect(resolved.systemPrompt).toBe('Custom prompt.');
  });

  it('builds provider env from runtime env and decrypted secret payload', async () => {
    mockProviders.findByName.mockResolvedValue({
      id: 'provider-1',
      name: 'openai',
      auth_type: 'oauth',
      secret_id: 'secret-1',
      runtime_env: {
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        ENABLED: true,
        OBJECT_VALUE: { nested: true },
      },
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockSecrets.findById.mockResolvedValue({
      id: 'secret-1',
      name: 'openai-secret',
      encrypted_value: 'encrypted',
      metadata: {},
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockVault.decrypt.mockReturnValue(
      JSON.stringify({ OPENAI_API_KEY: 'key-123', TOKEN_TTL: 3600 }),
    );

    const env = await service.buildProviderEnvByName('openai');

    expect(env).toEqual({
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      ENABLED: 'true',
      OPENAI_API_KEY: 'key-123',
      TOKEN_TTL: '3600',
    });
    expect(env.OBJECT_VALUE).toBeUndefined();
  });

  it('resolves runner provider config with explicit field names from runtime env', async () => {
    mockProviders.findByName.mockImplementation(async (name: string) => {
      if (name === 'custom-minimax') {
        return {
          id: 'provider-legacy-rich',
          name: 'custom-minimax',
          auth_type: 'api_key',
          secret_id: 'secret-legacy-1',
          runtime_env: {
            pi_provider: 'minimax',
            api_key_field: 'CUSTOM_MINIMAX_API_KEY',
            base_url_field: 'CUSTOM_MINIMAX_BASE_URL',
          },
          is_active: true,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
        };
      }

      return null;
    });

    mockModels.findByName.mockResolvedValue({
      id: 'model-legacy-1',
      name: 'minimax-model',
      provider_name: 'custom-minimax',
      token_limit: 128000,
      default_for_execution: true,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: false,
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockSecrets.findById.mockResolvedValue({
      id: 'secret-legacy-1',
      name: 'legacy-secret',
      encrypted_value: 'encrypted-legacy',
      metadata: {},
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockVault.decrypt.mockReturnValue(
      JSON.stringify({
        CUSTOM_MINIMAX_API_KEY: 'legacy-key',
        CUSTOM_MINIMAX_BASE_URL: 'https://llm.chutes.ai/v1/',
      }),
    );

    const resolved = await service.resolveRunnerProviderConfig({
      modelName: 'minimax-model',
      providerName: 'custom-minimax',
    });

    expect(resolved).toEqual({
      provider: 'minimax',
      apiKey: 'legacy-key',
      auth: { type: 'api_key', apiKey: 'legacy-key' },
      baseUrl: 'https://llm.chutes.ai/v1',
      providerEnv: {
        pi_provider: 'minimax',
        api_key_field: 'CUSTOM_MINIMAX_API_KEY',
        base_url_field: 'CUSTOM_MINIMAX_BASE_URL',
        CUSTOM_MINIMAX_API_KEY: 'legacy-key',
        CUSTOM_MINIMAX_BASE_URL: 'https://llm.chutes.ai/v1/',
      },
    });
    expect(
      mockRunnerProviderSelection.resolveRunnerProviderAuth.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(
      mockRunnerProviderSelection.resolveProviderRegistrationConfig.mock.calls
        .length,
    ).toBeGreaterThan(0);
  });

  it('resolves provider-scoped API key without hardcoded provider aliases', async () => {
    mockProviders.findByName.mockResolvedValue({
      id: 'provider-1',
      name: 'minimax',
      auth_type: 'api_key',
      secret_id: 'secret-1',
      runtime_env: {},
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockModels.findByName.mockResolvedValue({
      id: 'model-1',
      name: 'MiniMax-M2.5',
      provider_name: 'minimax',
      token_limit: 128000,
      default_for_execution: true,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: false,
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockSecrets.findById.mockResolvedValue({
      id: 'secret-1',
      name: 'minimax-secret',
      encrypted_value: 'encrypted',
      metadata: {},
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockVault.decrypt.mockReturnValue(
      JSON.stringify({ MINIMAX_API_KEY: 'minimax-key' }),
    );

    const resolved = await service.resolveRunnerProviderConfig({
      modelName: 'MiniMax-M2.5',
      providerName: 'minimax',
    });

    expect(resolved.provider).toBe('minimax');
    expect(resolved.apiKey).toBe('minimax-key');
    expect(resolved.auth).toEqual({ type: 'api_key', apiKey: 'minimax-key' });
  });

  it('supports plain JSON secret payload fallback when decrypt fails', async () => {
    mockProviders.findByName.mockResolvedValue({
      id: 'provider-2',
      name: 'openai',
      auth_type: 'api_key',
      secret_id: 'secret-2',
      runtime_env: {},
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockSecrets.findById.mockResolvedValue({
      id: 'secret-2',
      name: 'openai-secret-plain',
      encrypted_value: '{"OPENAI_API_KEY":"plain-json-key"}',
      metadata: {},
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    });

    mockVault.decrypt.mockImplementation(() => {
      throw new Error('decrypt failed');
    });

    const env = await service.buildProviderEnvByName('openai');
    expect(env).toEqual({ OPENAI_API_KEY: 'plain-json-key' });
  });

  describe('resolveRunnerProviderConfig — scoped provider resolution', () => {
    it('resolves by providerId and uses resolved provider name safely', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findById.mockResolvedValue({
        id: 'prov-scoped-1',
        name: 'scoped-provider',
        auth_type: 'api_key',
        secret_id: 'secret-scoped-1',
        runtime_env: {},
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockSecrets.findById.mockResolvedValue({
        id: 'secret-scoped-1',
        name: 'scoped-secret',
        encrypted_value: 'enc-scoped',
        metadata: {},
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockVault.decrypt.mockReturnValue(
        JSON.stringify({ SCOPED_API_KEY: 'scoped-key' }),
      );

      const resolved = await service.resolveRunnerProviderConfig({
        modelName: 'unknown-model',
        providerId: 'prov-scoped-1',
      });

      expect(resolved.provider).toBe('scoped-provider');
      expect(resolved.auth).toEqual({
        type: 'api_key',
        apiKey: 'scoped-key',
      });
      expect(mockProviders.findByName).not.toHaveBeenCalled();
    });

    it('resolves by providerSource + providerName delegation', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findActiveByOwnerAndName.mockResolvedValue({
        id: 'prov-user-1',
        name: 'openai',
        auth_type: 'api_key',
        secret_id: 'secret-u1',
        runtime_env: {},
        is_active: true,
        owner_type: 'user',
        owner_id: 'user-1',
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockSecrets.findById.mockResolvedValue({
        id: 'secret-u1',
        name: 'user-secret',
        encrypted_value: 'enc-u1',
        metadata: {},
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockVault.decrypt.mockReturnValue(
        JSON.stringify({ OPENAI_API_KEY: 'user-key' }),
      );

      const resolved = await service.resolveRunnerProviderConfig({
        modelName: 'unknown-model',
        providerSource: 'user',
        providerName: 'openai',
        executionContext: { ownerType: 'user', ownerId: 'user-1' },
      });

      expect(resolved.provider).toBe('openai');
      expect(resolved.apiKey).toBe('user-key');
      expect(mockProviders.findByName).not.toHaveBeenCalled();
    });

    it('routes providerName + executionContext through contextual lookup before global', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findActiveByOwnerAndName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'prov-global-1',
          name: 'openai',
          auth_type: 'api_key',
          secret_id: 'secret-g1',
          runtime_env: {},
          is_active: true,
          owner_type: 'global',
          owner_id: null,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
        });

      mockSecrets.findById.mockResolvedValue({
        id: 'secret-g1',
        name: 'global-secret',
        encrypted_value: 'enc-g1',
        metadata: {},
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockVault.decrypt.mockReturnValue(
        JSON.stringify({ OPENAI_API_KEY: 'global-key' }),
      );

      const resolved = await service.resolveRunnerProviderConfig({
        modelName: 'unknown-model',
        providerName: 'openai',
        executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
      });

      expect(resolved.provider).toBe('openai');
      expect(resolved.apiKey).toBe('global-key');
      expect(resolved.auth).toEqual({
        type: 'api_key',
        apiKey: 'global-key',
      });
      expect(mockProviders.findByName).not.toHaveBeenCalled();
      expect(mockProviders.findActiveByOwnerAndName).toHaveBeenCalledTimes(2);
    });

    it('propagates non-NotFound errors from provider reference resolution', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findById.mockRejectedValue(new Error('connection refused'));

      await expect(
        service.resolveRunnerProviderConfig({
          modelName: 'some-model',
          providerId: 'prov-1',
        }),
      ).rejects.toThrow('connection refused');
    });

    it('returns empty config with provider name when scoped resolution throws NotFoundException', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findById.mockResolvedValue(null);

      const resolved = await service.resolveRunnerProviderConfig({
        modelName: 'some-model',
        providerId: 'prov-nonexistent',
      });

      expect(resolved.provider).toBe('openai');
      expect(resolved.apiKey).toBe('');
      expect(resolved.providerEnv).toEqual({});
    });

    it('extracts provider_id and provider_source from agent profile settings', async () => {
      mockAgentProfiles.findByName.mockResolvedValue({
        id: 'profile-scoped',
        name: 'scoped-agent',
        model_name: 'gpt-5.5',
        provider_name: 'openai',
        provider_id: 'prov-scoped-1',
        provider_source: 'user',
        system_prompt: 'Scoped prompt',
        tier_preference: 'light',
        source: 'seeded',
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockModels.findDefaultForUseCase.mockResolvedValue({
        id: 'model-1',
        name: 'default-model',
        provider_name: 'default-prov',
        token_limit: 128000,
        default_for_execution: true,
        default_for_distillation: false,
        default_for_summarization: false,
        default_for_session: false,
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      const settings = await service.resolveStepSettings({
        agentProfileName: 'scoped-agent',
      });

      expect(settings.model).toBe('gpt-5.5');
      expect(settings.providerName).toBe('openai');
      expect(settings.providerId).toBe('prov-scoped-1');
      expect(settings.providerSource).toBe('user');
    });

    it('preserves old findByName behavior when no scoped fields or context are supplied', async () => {
      mockModels.findByName.mockResolvedValue(null);
      mockProviders.findByName.mockResolvedValue({
        id: 'prov-old',
        name: 'legacy-prov',
        auth_type: 'api_key',
        secret_id: 'secret-old',
        runtime_env: {},
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockSecrets.findById.mockResolvedValue({
        id: 'secret-old',
        name: 'old-secret',
        encrypted_value: 'enc-old',
        metadata: {},
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });

      mockVault.decrypt.mockReturnValue(
        JSON.stringify({ LEGACY_PROV_API_KEY: 'legacy' }),
      );

      const resolved = await service.resolveRunnerProviderConfig({
        modelName: 'some-model',
        providerName: 'legacy-prov',
      });

      expect(resolved.provider).toBe('legacy-prov');
      expect(resolved.apiKey).toBe('legacy');
      expect(resolved.auth).toEqual({
        type: 'api_key',
        apiKey: 'legacy',
      });
      expect(mockProviders.findById).not.toHaveBeenCalled();
      expect(mockProviders.findActiveByOwnerAndName).not.toHaveBeenCalled();
    });
  });

  describe('fallback chain resolution in resolveStepSettings', () => {
    it('resolveStepSettings advances to the profile chain entry when the primary provider is cooled', async () => {
      mockAgentProfiles.findByName.mockResolvedValue({
        id: 'profile-fb',
        name: 'architect-agent',
        model_name: 'opus',
        provider_name: 'anthropic-a',
        system_prompt: 'You are an architect.',
        tier_preference: 'heavy',
        source: 'seeded',
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        fallback_chain: [{ provider_name: 'openai-b', model_name: 'gpt-4' }],
      });

      mockFallbackResolver.resolve.mockResolvedValue({
        provider_name: 'openai-b',
        model_name: 'gpt-4',
      });

      const settings = await service.resolveStepSettings({
        agentProfileName: 'architect-agent',
      });

      expect(settings.providerName).toBe('openai-b');
      expect(settings.model).toBe('gpt-4');
      expect(settings.providerId).toBeNull();
    });

    it('resolveStepSettings is unchanged when resolver returns the primary', async () => {
      mockAgentProfiles.findByName.mockResolvedValue({
        id: 'profile-primary',
        name: 'architect-agent',
        model_name: 'opus',
        provider_name: 'anthropic-a',
        system_prompt: 'You are an architect.',
        tier_preference: 'heavy',
        source: 'seeded',
        is_active: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      });
      // Default mock returns params.primary — no override needed.

      const settings = await service.resolveStepSettings({
        agentProfileName: 'architect-agent',
      });

      expect(settings.providerName).toBe('anthropic-a');
      expect(settings.model).toBe('opus');
    });
  });

  it('calls ensureFreshOAuthCredential before reading the secret during runner config resolution', async () => {
    const provider = {
      id: 'prov-1',
      name: 'anthropic-claude-code',
      auth_type: 'api_key',
      is_active: true,
      secret_id: 'sec-1',
      runtime_env: {},
    } as unknown as LlmProvider;

    const order: string[] = [];

    mockProviderOAuth.ensureFreshOAuthCredential.mockImplementation(
      async () => {
        order.push('refresh');
      },
    );

    mockModels.findByName.mockResolvedValue(null);
    mockProviders.findByName.mockResolvedValue(provider);

    vi.spyOn(service, 'resolveSecretMap').mockImplementation(async () => {
      order.push('readSecret');
      return { ANTHROPIC_API_KEY: 'fresh' };
    });

    await service.resolveRunnerProviderConfig({
      modelName: 'm',
      providerName: 'anthropic-claude-code',
    });

    expect(mockProviderOAuth.ensureFreshOAuthCredential).toHaveBeenCalledWith(
      provider,
    );
    expect(order).toEqual(['refresh', 'readSecret']);
  });
});
