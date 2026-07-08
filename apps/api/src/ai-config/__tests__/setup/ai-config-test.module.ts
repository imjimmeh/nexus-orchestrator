import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { vi, type Mock } from 'vitest';
import { AiConfigurationService } from '../../ai-configuration.service';
import { AgentProfileRepository } from '../../database/repositories/agent-profile.repository';
import { LlmModelRepository } from '../../database/repositories/llm-model.repository';
import { LlmProviderRepository } from '../../database/repositories/llm-provider.repository';
import { SecretStoreRepository } from '../../../security/database/repositories/secret-store.repository';
import { SecretVaultService } from '../../../security/secret-vault.service';
import { ModelSelectionFactory } from '../../strategies/model-selection';
import { AgentSkillsService } from '../../services/agent-skills.service';
import { ProviderReferenceService } from '../../services/provider-reference.service';
import { ProviderOAuthService } from '../../services/provider-oauth.service';
import { RunnerProviderSelectionService } from '../../services/runner-provider-selection.service';
import { FallbackChainResolverService } from '../../fallback/fallback-chain-resolver.service';
import {
  MockAgentProfileRepository,
  MockLlmModelRepository,
  MockLlmProviderRepository,
  MockSecretStoreRepository,
  MockSecretVaultService,
  MockConfigService,
} from './ai-config-mocks.factory';

export interface AiConfigTestModuleOptions {
  agentProfileRepository?: Partial<MockAgentProfileRepository>;
  llmModelRepository?: Partial<MockLlmModelRepository>;
  llmProviderRepository?: Partial<MockLlmProviderRepository>;
  secretStoreRepository?: Partial<MockSecretStoreRepository>;
  secretVaultService?: Partial<MockSecretVaultService>;
  configService?: Partial<MockConfigService>;
  modelSelectionFactory?: Partial<MockModelSelectionFactory>;
  agentSkillsService?: Partial<MockAgentSkillsService>;
  providerOAuthService?: Partial<MockProviderOAuthService>;
  fallbackChainResolverService?: Partial<MockFallbackChainResolverService>;
}

export interface AiConfigTestContext {
  module: TestingModule;
  service: AiConfigurationService;
  agentProfileRepository: MockAgentProfileRepository;
  llmModelRepository: MockLlmModelRepository;
  llmProviderRepository: MockLlmProviderRepository;
  secretStoreRepository: MockSecretStoreRepository;
  secretVaultService: MockSecretVaultService;
  configService: MockConfigService;
  modelSelectionFactory: MockModelSelectionFactory;
  agentSkillsService: MockAgentSkillsService;
  providerOAuthService: MockProviderOAuthService;
  fallbackChainResolverService: MockFallbackChainResolverService;
  runnerProviderSelection: RunnerProviderSelectionService;
}

export interface MockModelSelectionFactory {
  selectModel: Mock<(useCase: string) => Promise<string>>;
}

export interface MockAgentSkillsService {
  listCategories: ReturnType<typeof vi.fn>;
}

interface MockProviderOAuthService {
  ensureFreshOAuthCredential: ReturnType<typeof vi.fn>;
}

interface MockFallbackChainResolverService {
  resolve: ReturnType<typeof vi.fn>;
}

function createDefaultMocks(config: Record<string, string> = {}): {
  agentProfileRepository: MockAgentProfileRepository;
  llmModelRepository: MockLlmModelRepository;
  llmProviderRepository: MockLlmProviderRepository;
  secretStoreRepository: MockSecretStoreRepository;
  secretVaultService: MockSecretVaultService;
  configService: MockConfigService;
  modelSelectionFactory: MockModelSelectionFactory;
  agentSkillsService: MockAgentSkillsService;
  providerOAuthService: MockProviderOAuthService;
  fallbackChainResolverService: MockFallbackChainResolverService;
} {
  return {
    agentProfileRepository: {
      findByName: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    llmModelRepository: {
      findByName: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      findDefaultForUseCase: vi.fn(),
      findDefaultForEmbedding: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    llmProviderRepository: {
      findByName: vi.fn(),
      findById: vi.fn(),
      findActiveByOwnerAndName: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    secretStoreRepository: {
      findById: vi.fn(),
      findByName: vi.fn(),
      findByOwnerAndName: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    secretVaultService: {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    },
    configService: {
      get: vi.fn((key: string) => config[key] ?? undefined),
    },
    modelSelectionFactory: {
      selectModel: vi.fn().mockResolvedValue('test-model'),
    },
    agentSkillsService: {
      listCategories: vi.fn(() => []),
    },
    providerOAuthService: {
      ensureFreshOAuthCredential: vi.fn().mockResolvedValue(undefined),
    },
    fallbackChainResolverService: {
      resolve: vi
        .fn()
        .mockImplementation(({ primary }) => Promise.resolve(primary)),
    },
  };
}

export async function createAiConfigTestingModule(
  options: AiConfigTestModuleOptions = {},
  config: Record<string, string> = {},
): Promise<TestingModule> {
  const defaultMocks = createDefaultMocks(config);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiConfigurationService,
      {
        provide: ConfigService,
        useValue: { ...defaultMocks.configService, ...options.configService },
      },
      {
        provide: AgentProfileRepository,
        useValue: {
          ...defaultMocks.agentProfileRepository,
          ...options.agentProfileRepository,
        },
      },
      {
        provide: LlmModelRepository,
        useValue: {
          ...defaultMocks.llmModelRepository,
          ...options.llmModelRepository,
        },
      },
      {
        provide: LlmProviderRepository,
        useValue: {
          ...defaultMocks.llmProviderRepository,
          ...options.llmProviderRepository,
        },
      },
      {
        provide: SecretStoreRepository,
        useValue: {
          ...defaultMocks.secretStoreRepository,
          ...options.secretStoreRepository,
        },
      },
      {
        provide: SecretVaultService,
        useValue: {
          ...defaultMocks.secretVaultService,
          ...options.secretVaultService,
        },
      },
      {
        provide: ModelSelectionFactory,
        useValue: {
          ...defaultMocks.modelSelectionFactory,
          ...options.modelSelectionFactory,
        },
      },
      {
        provide: AgentSkillsService,
        useValue: {
          ...defaultMocks.agentSkillsService,
          ...options.agentSkillsService,
        },
      },
      {
        provide: ProviderReferenceService,
        useClass: ProviderReferenceService,
      },
      {
        provide: ProviderOAuthService,
        useValue: {
          ...defaultMocks.providerOAuthService,
          ...options.providerOAuthService,
        },
      },
      {
        provide: FallbackChainResolverService,
        useValue: {
          ...defaultMocks.fallbackChainResolverService,
          ...options.fallbackChainResolverService,
        },
      },
      {
        provide: RunnerProviderSelectionService,
        useClass: RunnerProviderSelectionService,
      },
    ],
  }).compile();

  return module;
}

export async function createAiConfigTestingModuleWithDefaults(
  config: Record<string, string> = {
    MODEL: 'env-model',
    DISTILLATION_MODEL: 'env-distill',
    SUMMARIZATION_MODEL: 'env-summary',
    SESSION_MODEL: 'env-session',
    SECRET_ENCRYPTION_KEY: 'test-encryption-key',
    JWT_SECRET: 'test-jwt-secret',
  },
): Promise<AiConfigTestContext> {
  const mocks = createDefaultMocks(config);

  const module = await Test.createTestingModule({
    providers: [
      AiConfigurationService,
      { provide: ConfigService, useValue: mocks.configService },
      {
        provide: AgentProfileRepository,
        useValue: mocks.agentProfileRepository,
      },
      { provide: LlmModelRepository, useValue: mocks.llmModelRepository },
      { provide: LlmProviderRepository, useValue: mocks.llmProviderRepository },
      { provide: SecretStoreRepository, useValue: mocks.secretStoreRepository },
      { provide: SecretVaultService, useValue: mocks.secretVaultService },
      { provide: ModelSelectionFactory, useValue: mocks.modelSelectionFactory },
      { provide: AgentSkillsService, useValue: mocks.agentSkillsService },
      {
        provide: ProviderReferenceService,
        useClass: ProviderReferenceService,
      },
      {
        provide: ProviderOAuthService,
        useValue: mocks.providerOAuthService,
      },
      {
        provide: FallbackChainResolverService,
        useValue: mocks.fallbackChainResolverService,
      },
      {
        provide: RunnerProviderSelectionService,
        useClass: RunnerProviderSelectionService,
      },
    ],
  }).compile();

  const service = module.get<AiConfigurationService>(AiConfigurationService);
  const runnerProviderSelection = module.get<RunnerProviderSelectionService>(
    RunnerProviderSelectionService,
  );

  return {
    module,
    service,
    agentProfileRepository: mocks.agentProfileRepository,
    llmModelRepository: mocks.llmModelRepository,
    llmProviderRepository: mocks.llmProviderRepository,
    secretStoreRepository: mocks.secretStoreRepository,
    secretVaultService: mocks.secretVaultService,
    configService: mocks.configService,
    modelSelectionFactory: mocks.modelSelectionFactory,
    agentSkillsService: mocks.agentSkillsService,
    providerOAuthService: mocks.providerOAuthService,
    fallbackChainResolverService: mocks.fallbackChainResolverService,
    runnerProviderSelection,
  };
}
