import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { AgentProfileRepository } from '../../database/repositories/agent-profile.repository';
import { LlmModelRepository } from '../../database/repositories/llm-model.repository';
import { LlmProviderRepository } from '../../database/repositories/llm-provider.repository';
import { SecretStoreRepository } from '../../../security/database/repositories/secret-store.repository';
import { SecretVaultService } from '../../../security/secret-vault.service';
import { AgentProfile } from '../../database/entities/agent-profile.entity';
import { LlmModel } from '../../database/entities/llm-model.entity';
import { LlmProvider } from '../../database/entities/llm-provider.entity';
import { SecretStore } from '../../../security/database/entities/secret-store.entity';
import { ModelUseCase } from '../../database/repositories/llm-model.repository';

export interface MockAgentProfileRepository {
  findByName: Mock;
  findById: Mock;
  findAll: Mock;
  create: Mock;
  update: Mock;
  remove: Mock;
}

export function createMockAgentProfileRepository(): MockAgentProfileRepository {
  return {
    findByName: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

export interface MockLlmModelRepository {
  findByName: Mock;
  findById: Mock;
  findAll: Mock;
  findDefaultForUseCase: Mock;
  findDefaultForEmbedding: Mock;
  create: Mock;
  update: Mock;
  remove: Mock;
}

export function createMockLlmModelRepository(): MockLlmModelRepository {
  return {
    findByName: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    findDefaultForUseCase: vi.fn(),
    findDefaultForEmbedding: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

export interface MockLlmProviderRepository {
  findByName: Mock;
  findById: Mock;
  findActiveByOwnerAndName: Mock;
  findAll: Mock;
  create: Mock;
  update: Mock;
  remove: Mock;
}

export function createMockLlmProviderRepository(): MockLlmProviderRepository {
  return {
    findByName: vi.fn(),
    findById: vi.fn(),
    findActiveByOwnerAndName: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

export interface MockSecretStoreRepository {
  findById: Mock;
  findByName: Mock;
  findByOwnerAndName: Mock;
  findAll: Mock;
  create: Mock;
  update: Mock;
  remove: Mock;
}

export function createMockSecretStoreRepository(): MockSecretStoreRepository {
  return {
    findById: vi.fn(),
    findByName: vi.fn(),
    findByOwnerAndName: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

export interface MockSecretVaultService {
  encrypt: Mock;
  decrypt: Mock;
}

export function createMockSecretVaultService(): MockSecretVaultService {
  return {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };
}

export interface MockConfigService {
  get: Mock;
}

export function createMockConfigService(
  config: Record<string, string> = {},
): MockConfigService {
  return {
    get: vi.fn((key: string) => config[key] ?? undefined),
  };
}

export interface AiConfigMocks {
  agentProfileRepository: MockAgentProfileRepository;
  llmModelRepository: MockLlmModelRepository;
  llmProviderRepository: MockLlmProviderRepository;
  secretStoreRepository: MockSecretStoreRepository;
  secretVaultService: MockSecretVaultService;
  configService: MockConfigService;
}

export function createAiConfigMocks(
  config: Record<string, string> = {},
): AiConfigMocks {
  return {
    agentProfileRepository: createMockAgentProfileRepository(),
    llmModelRepository: createMockLlmModelRepository(),
    llmProviderRepository: createMockLlmProviderRepository(),
    secretStoreRepository: createMockSecretStoreRepository(),
    secretVaultService: createMockSecretVaultService(),
    configService: createMockConfigService(config),
  };
}

export const DEFAULT_TEST_DATE = '2026-01-01T00:00:00Z';

export function createMockAgentProfile(
  overrides?: Partial<AgentProfile>,
): AgentProfile {
  return {
    id: 'agent-profile-1',
    name: 'qa_automation',
    model_name: 'profile-model',
    provider_name: 'profile-provider',
    system_prompt: 'profile-prompt',
    tier_preference: 'light',
    tool_policy: null,
    source: 'admin',
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,

    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...overrides,
  };
}

export function createMockLlmModel(overrides?: Partial<LlmModel>): LlmModel {
  return {
    id: 'model-1',
    name: 'db-model',
    provider_name: 'openai',
    token_limit: 128000,
    supports_vision: false,
    default_for_execution: true,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: true,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...overrides,
  };
}

export function createMockLlmProvider(
  overrides?: Partial<LlmProvider>,
): LlmProvider {
  return {
    id: 'provider-1',
    name: 'openai',
    auth_type: 'oauth',
    secret_id: 'secret-1',
    runtime_env: {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      ENABLED: true,
    },
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    oauth_authorization_url: null,
    oauth_token_url: null,
    oauth_client_id: null,
    oauth_client_secret_id: null,
    oauth_scopes: null,
    oauth_redirect_uri: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...overrides,
  };
}

export function createMockSecretStore(
  overrides?: Partial<SecretStore>,
): SecretStore {
  return {
    id: 'secret-1',
    name: 'openai-secret',
    encrypted_value: 'encrypted-payload',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...overrides,
  };
}

export function setupMockRepositories(mocks: AiConfigMocks): void {
  mocks.agentProfileRepository.findByName.mockResolvedValue(null);
  mocks.agentProfileRepository.findById.mockResolvedValue(null);
  mocks.agentProfileRepository.findAll.mockResolvedValue([]);
  mocks.agentProfileRepository.create.mockImplementation(
    (data: Partial<AgentProfile>) => createMockAgentProfile(data),
  );
  mocks.agentProfileRepository.update.mockResolvedValue(null);
  mocks.agentProfileRepository.remove.mockResolvedValue(undefined);

  mocks.llmModelRepository.findByName.mockResolvedValue(null);
  mocks.llmModelRepository.findById.mockResolvedValue(null);
  mocks.llmModelRepository.findAll.mockResolvedValue([]);
  mocks.llmModelRepository.findDefaultForUseCase.mockResolvedValue(null);
  mocks.llmModelRepository.findDefaultForEmbedding.mockResolvedValue(null);
  mocks.llmModelRepository.create.mockImplementation(
    (data: Partial<LlmModel>) => createMockLlmModel(data),
  );
  mocks.llmModelRepository.update.mockResolvedValue(null);
  mocks.llmModelRepository.remove.mockResolvedValue(undefined);

  mocks.llmProviderRepository.findByName.mockResolvedValue(null);
  mocks.llmProviderRepository.findById.mockResolvedValue(null);
  mocks.llmProviderRepository.findActiveByOwnerAndName.mockResolvedValue(null);
  mocks.llmProviderRepository.findAll.mockResolvedValue([]);
  mocks.llmProviderRepository.create.mockImplementation(
    (data: Partial<LlmProvider>) => createMockLlmProvider(data),
  );
  mocks.llmProviderRepository.update.mockResolvedValue(null);
  mocks.llmProviderRepository.remove.mockResolvedValue(undefined);

  mocks.secretStoreRepository.findById.mockResolvedValue(null);
  mocks.secretStoreRepository.findByName.mockResolvedValue(null);
  mocks.secretStoreRepository.findByOwnerAndName.mockResolvedValue(null);
  mocks.secretStoreRepository.findAll.mockResolvedValue([]);
  mocks.secretStoreRepository.create.mockImplementation(
    (data: Partial<SecretStore>) => createMockSecretStore(data),
  );
  mocks.secretStoreRepository.update.mockResolvedValue(null);
  mocks.secretStoreRepository.remove.mockResolvedValue(undefined);

  mocks.secretVaultService.encrypt.mockImplementation(
    (plainText: string) => `encrypted-${plainText}`,
  );
  mocks.secretVaultService.decrypt.mockImplementation(
    (encryptedPayload: string) => {
      try {
        const parsed = JSON.parse(encryptedPayload);
        if (parsed.data) {
          return 'decrypted-data';
        }
      } catch {
        return encryptedPayload.replace(/^encrypted-/, '');
      }
      return 'decrypted-data';
    },
  );
}
