import type { RunnerProviderRegistrationConfig } from '@nexus/core';
import { AgentProfile } from '../../database/entities/agent-profile.entity';
import { LlmModel } from '../../database/entities/llm-model.entity';
import { LlmProvider } from '../../database/entities/llm-provider.entity';
import { SecretStore } from '../../../security/database/entities/secret-store.entity';
import { ModelUseCase } from '../../database/repositories/llm-model.repository';

export const DEFAULT_TEST_DATE = '2026-01-01T00:00:00Z';

export const TEST_IDS = Object.freeze({
  AGENT_PROFILE_1: 'agent-profile-1',
  AGENT_PROFILE_2: 'agent-profile-2',
  AGENT_PROFILE_LEGACY: 'agent-profile-legacy-1',
  MODEL_1: 'model-1',
  MODEL_2: 'model-2',
  MODEL_LEGACY: 'model-legacy-1',
  MINIMAX_MODEL: 'minimax-model',
  PROVIDER_OPENAI: 'provider-1',
  PROVIDER_CUSTOM_MINIMAX: 'provider-custom-minimax',
  PROVIDER_MINIMAX: 'provider-minimax',
  PROVIDER_LEGACY_RICH: 'provider-legacy-rich',
  PROVIDER_2: 'provider-2',
  PROVIDER_CORPORATE_OAUTH: 'provider-corporate-oauth',
  SECRET_1: 'secret-1',
  SECRET_2: 'secret-2',
  SECRET_LEGACY: 'secret-legacy-1',
  SECRET_MINIMAX: 'secret-minimax',
  SECRET_CORPORATE_OAUTH: 'secret-corporate-oauth',
  CORPORATE_OAUTH_MODEL: 'corporate-oauth-model',
});

export function createMockAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_1,
    name: 'qa_automation',
    model_name: 'profile-model',
    provider_name: 'profile-provider',
    system_prompt: 'profile-prompt',
    tier_preference: 'light',
    tool_policy: null,
    source: 'admin' as const,
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as unknown as AgentProfile);
}

export function createMockAgentProfileWithNullFieldsFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_2,
    name: 'minimal-agent',
    model_name: null,
    provider_name: null,
    system_prompt: null,
    tier_preference: null,
    tool_policy: null,
    source: 'admin' as const,
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as unknown as AgentProfile);
}

export function createMockLegacyAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_LEGACY,
    name: 'testing-agent',
    model_name: 'MiniMaxAI/MiniMax-M2.5-TEE',
    provider_name: 'chutes.ai',
    system_prompt: 'legacy-prompt',
    tier_preference: 'light',
    tool_policy: null,
    source: 'seeded' as const,
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as unknown as AgentProfile);
}

export function createMockInactiveAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: 'agent-profile-inactive',
    name: 'inactive-agent',
    model_name: 'inactive-model',
    provider_name: 'inactive-provider',
    system_prompt: 'inactive-prompt',
    tier_preference: null,
    tool_policy: null,
    source: 'admin' as const,
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    is_active: false,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as unknown as AgentProfile);
}

export function createMockLlmModelFixture(
  useCase: ModelUseCase = 'execution',
): LlmModel {
  const defaults: Record<ModelUseCase, Partial<LlmModel>> = {
    execution: {
      id: TEST_IDS.MODEL_1,
      name: 'db-model',
      default_for_execution: true,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: true,
    },
    distillation: {
      id: TEST_IDS.MODEL_2,
      name: 'distillation-model',
      default_for_execution: false,
      default_for_distillation: true,
      default_for_summarization: false,
      default_for_session: false,
    },
    summarization: {
      id: 'model-summarization',
      name: 'summarization-model',
      default_for_execution: false,
      default_for_distillation: false,
      default_for_summarization: true,
      default_for_session: false,
    },
    session: {
      id: 'model-session',
      name: 'session-model',
      default_for_execution: false,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: true,
    },
    embedding: {
      id: 'model-embedding',
      name: 'embedding-model',
      default_for_execution: false,
      default_for_distillation: false,
      default_for_summarization: false,
      default_for_session: false,
      default_for_embedding: true,
      supports_embedding: true,
      embedding_dimension: 384,
    },
  };

  return Object.freeze({
    provider_name: 'openai',
    token_limit: 128000,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
    ...defaults[useCase],
  } as LlmModel);
}

export function createMockMinimaxModelFixture(): LlmModel {
  return Object.freeze({
    id: TEST_IDS.MINIMAX_MODEL,
    name: 'MiniMax-M2.5',
    provider_name: 'minimax',
    token_limit: 128000,
    default_for_execution: true,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: false,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as LlmModel);
}

export function createMockLegacyModelFixture(): LlmModel {
  return Object.freeze({
    id: TEST_IDS.MODEL_LEGACY,
    name: 'minimax-model',
    provider_name: 'custom-minimax',
    token_limit: 128000,
    default_for_execution: true,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: false,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as LlmModel);
}

export function createMockCorporateOAuthModelFixture(): LlmModel {
  return Object.freeze({
    id: TEST_IDS.CORPORATE_OAUTH_MODEL,
    name: 'corp-large',
    provider_name: 'corporate-ai',
    token_limit: 128000,
    default_for_execution: true,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: false,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as LlmModel);
}

export function createMockInactiveLlmModelFixture(): LlmModel {
  return Object.freeze({
    id: 'model-inactive',
    name: 'inactive-model',
    provider_name: 'openai',
    token_limit: 128000,
    default_for_execution: false,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: false,
    supports_embedding: false,
    embedding_dimension: null,
    default_for_embedding: false,
    is_active: false,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as LlmModel);
}

export function createMockOpenAiProviderFixture(): LlmProvider {
  return Object.freeze({
    id: TEST_IDS.PROVIDER_OPENAI,
    name: 'openai',
    auth_type: 'api_key',
    secret_id: TEST_IDS.SECRET_1,
    runtime_env: {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      ENABLED: true,
      OBJECT_VALUE: { nested: true },
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
  } as LlmProvider);
}

export function createMockCustomMinimaxProviderFixture(): LlmProvider {
  return Object.freeze({
    id: TEST_IDS.PROVIDER_CUSTOM_MINIMAX,
    name: 'custom-minimax',
    auth_type: 'api_key',
    secret_id: TEST_IDS.SECRET_LEGACY,
    runtime_env: {
      pi_provider: 'minimax',
      api_key_field: 'CUSTOM_MINIMAX_API_KEY',
      base_url_field: 'CUSTOM_MINIMAX_BASE_URL',
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
  } as LlmProvider);
}

export function createMockMinimaxProviderFixture(): LlmProvider {
  return Object.freeze({
    id: TEST_IDS.PROVIDER_MINIMAX,
    name: 'minimax',
    auth_type: 'api_key',
    secret_id: TEST_IDS.SECRET_MINIMAX,
    runtime_env: {},
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
  } as LlmProvider);
}

export function createMockCorporateOAuthProviderFixture(): LlmProvider {
  return Object.freeze({
    id: TEST_IDS.PROVIDER_CORPORATE_OAUTH,
    name: 'corporate-ai',
    auth_type: 'oauth',
    secret_id: TEST_IDS.SECRET_CORPORATE_OAUTH,
    runtime_env: {
      providerConfig: MOCK_CORPORATE_PROVIDER_CONFIG,
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
  } as LlmProvider);
}

export function createMockProviderWithEmptyRuntimeEnvFixture(): LlmProvider {
  return Object.freeze({
    id: TEST_IDS.PROVIDER_2,
    name: 'openai-plain',
    auth_type: 'api_key',
    secret_id: TEST_IDS.SECRET_2,
    runtime_env: {},
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
  } as LlmProvider);
}

export function createMockInactiveProviderFixture(): LlmProvider {
  return Object.freeze({
    id: 'provider-inactive',
    name: 'inactive-provider',
    auth_type: 'api_key',
    secret_id: null,
    runtime_env: {},
    is_active: false,
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
  } as LlmProvider);
}

export function createMockSecretStoreFixture(): SecretStore {
  return Object.freeze({
    id: TEST_IDS.SECRET_1,
    name: 'openai-secret',
    encrypted_value: 'encrypted-payload',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export function createMockSecretStoreWithJsonPayloadFixture(): SecretStore {
  return Object.freeze({
    id: TEST_IDS.SECRET_2,
    name: 'openai-secret-plain',
    encrypted_value: JSON.stringify({ OPENAI_API_KEY: 'plain-json-key' }),
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export function createMockLegacySecretStoreFixture(): SecretStore {
  return Object.freeze({
    id: TEST_IDS.SECRET_LEGACY,
    name: 'legacy-secret',
    encrypted_value: 'encrypted-legacy',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export function createMockMinimaxSecretStoreFixture(): SecretStore {
  return Object.freeze({
    id: TEST_IDS.SECRET_MINIMAX,
    name: 'minimax-secret',
    encrypted_value: 'encrypted',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export function createMockCorporateOAuthSecretStoreFixture(): SecretStore {
  return Object.freeze({
    id: TEST_IDS.SECRET_CORPORATE_OAUTH,
    name: 'corporate-oauth-secret',
    encrypted_value: 'encrypted-corporate-oauth',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export function createMockOpenAiCodexOAuthProviderFixture(): LlmProvider {
  return Object.freeze({
    id: 'provider-openai-codex',
    name: 'ChatGPT Plus/Pro (Codex Subscription)',
    auth_type: 'oauth',
    secret_id: 'secret-openai-codex',
    runtime_env: {
      pi_provider: 'openai-codex',
    },
    is_active: true,
    owner_type: 'global',
    owner_id: null,
    oauth_authorization_url: 'https://auth.openai.com/oauth/authorize',
    oauth_token_url: 'https://auth.openai.com/oauth/token',
    oauth_client_id: null,
    oauth_client_secret_id: null,
    oauth_scopes: null,
    oauth_redirect_uri: 'http://localhost:3120/providers/oauth/callback',
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as LlmProvider);
}

export function createMockOpenAiCodexOAuthModelFixture(): LlmModel {
  return Object.freeze({
    id: 'model-openai-codex',
    name: 'gpt-5.5',
    provider_name: 'ChatGPT Plus/Pro (Codex Subscription)',
    token_limit: 272000,
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
  } as LlmModel);
}

export function createMockOpenAiCodexOAuthSecretStoreFixture(): SecretStore {
  return Object.freeze({
    id: 'secret-openai-codex',
    name: 'openai-codex-oauth',
    encrypted_value: 'enc-openai-codex',
    metadata: {},
    owner_type: 'global',
    owner_id: null,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as SecretStore);
}

export const MOCK_OPENAI_CODEX_PROVIDER_CONFIG = Object.freeze({
  name: 'ChatGPT Plus/Pro (Codex Subscription)',
  baseUrl: 'https://chatgpt.com/backend-api',
  api: 'openai-codex-responses',
  authHeader: true,
  oauth: {
    name: 'ChatGPT Plus/Pro (Codex Subscription)',
    refresh: {
      tokenUrl: 'https://auth.openai.com/oauth/token',
      refreshTokenParam: 'refresh_token',
      accessTokenPath: 'access_token',
      refreshTokenPath: 'refresh_token',
      expiresInPath: 'expires_in',
    },
  },
  models: [
    {
      id: 'gpt-5.3-codex-spark',
      name: 'GPT-5.3 Codex Spark',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text'],
      cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 128000,
    },
    {
      id: 'gpt-5.4-mini',
      name: 'GPT-5.4 mini',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
    {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      contextWindow: 272000,
      maxTokens: 128000,
    },
  ],
} satisfies RunnerProviderRegistrationConfig);

export const MOCK_CORPORATE_PROVIDER_CONFIG = Object.freeze({
  name: 'Corporate AI',
  baseUrl: 'https://ai.corp.example/v1',
  api: 'openai-responses',
  authHeader: true,
  oauth: {
    name: 'Corporate AI (SSO)',
    refresh: {
      tokenUrl: 'https://sso.corp.example/oauth/token',
      refreshTokenParam: 'refresh_token',
      accessTokenPath: 'access_token',
      refreshTokenPath: 'refresh_token',
      expiresInPath: 'expires_in',
    },
  },
  models: [
    {
      id: 'corp-large',
      name: 'Corporate Large',
      api: 'openai-responses',
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    },
  ],
} satisfies RunnerProviderRegistrationConfig);

export interface SecretPayload {
  OPENAI_API_KEY?: string;
  TOKEN_TTL?: number;
  CUSTOM_MINIMAX_API_KEY?: string;
  CUSTOM_MINIMAX_BASE_URL?: string;
  MINIMAX_API_KEY?: string;
  oauth?: {
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: number;
  };
}

export const MOCK_SECRET_PAYLOADS: Record<string, SecretPayload> =
  Object.freeze({
    openai: { OPENAI_API_KEY: 'fixtureOpenAiCredential', TOKEN_TTL: 3600 },
    legacy: {
      CUSTOM_MINIMAX_API_KEY: 'legacyCredentialValue',
      CUSTOM_MINIMAX_BASE_URL: 'https://llm.chutes.ai/v1/',
    },
    minimax: { MINIMAX_API_KEY: 'minimaxCredentialValue' },
    corporateOauth: {
      oauth: {
        refreshToken: 'fixtureRefreshCredential',
        accessToken: 'fixtureAccessCredential',
        expiresAt: 4102444800000,
      },
    },
    openaiCodexOauth: {
      oauth: {
        refreshToken: 'openai-codex-refresh',
        accessToken: 'openai-codex-access',
        expiresAt: 4102444800000,
      },
    },
  });

export const MOCK_ENV_CONFIG = Object.freeze({
  MODEL: 'env-model',
  DISTILLATION_MODEL: 'env-distill',
  SUMMARIZATION_MODEL: 'env-summary',
  SESSION_MODEL: 'env-session',
  SECRET_ENCRYPTION_KEY: 'test-encryption-key',
  JWT_SECRET: 'test-jwt-secret',
});

export interface ResolvedStepSettings {
  model: string;
  systemPrompt: string;
  providerName: string;
}

export interface RunnerProviderConfig {
  provider: string;
  apiKey?: string;
  auth?: unknown;
  baseUrl?: string;
  providerConfig?: unknown;
  providerEnv: Record<string, unknown>;
}

export const mockAgentProfile: AgentProfile = createMockAgentProfileFixture();
export const mockLegacyAgentProfile: AgentProfile =
  createMockLegacyAgentProfileFixture();
export const mockInactiveAgentProfile: AgentProfile =
  createMockInactiveAgentProfileFixture();

export const mockExecutionModel: LlmModel =
  createMockLlmModelFixture('execution');
export const mockDistillationModel: LlmModel =
  createMockLlmModelFixture('distillation');
export const mockMinimaxModel: LlmModel = createMockMinimaxModelFixture();
export const mockLegacyModel: LlmModel = createMockLegacyModelFixture();

export const mockOpenAiProvider: LlmProvider =
  createMockOpenAiProviderFixture();
export const mockCustomMinimaxProvider: LlmProvider =
  createMockCustomMinimaxProviderFixture();
export const mockMinimaxProvider: LlmProvider =
  createMockMinimaxProviderFixture();

export const mockSecretStore: SecretStore = createMockSecretStoreFixture();
export const mockSecretStoreWithJsonPayload: SecretStore =
  createMockSecretStoreWithJsonPayloadFixture();
export const mockLegacySecretStore: SecretStore =
  createMockLegacySecretStoreFixture();
