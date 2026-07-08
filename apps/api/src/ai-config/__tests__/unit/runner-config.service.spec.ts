import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiConfigTestingModuleWithDefaults } from '../setup/ai-config-test.module';
import { AiConfigTestContext } from '../setup/ai-config-test.module';
import {
  createMockCustomMinimaxProviderFixture,
  createMockMinimaxProviderFixture,
  createMockLegacyModelFixture,
  createMockMinimaxModelFixture,
  createMockLegacySecretStoreFixture,
  createMockMinimaxSecretStoreFixture,
  createMockCorporateOAuthModelFixture,
  createMockCorporateOAuthProviderFixture,
  createMockCorporateOAuthSecretStoreFixture,
  createMockOpenAiCodexOAuthModelFixture,
  createMockOpenAiCodexOAuthProviderFixture,
  createMockOpenAiCodexOAuthSecretStoreFixture,
  MOCK_CORPORATE_PROVIDER_CONFIG,
  MOCK_OPENAI_CODEX_PROVIDER_CONFIG,
  MOCK_SECRET_PAYLOADS,
} from '../setup/ai-config-test.fixtures';

vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-ai')>(
    '@earendil-works/pi-ai',
  );
  return {
    ...actual,
    getModels: vi.fn(actual.getModels),
  };
});

import { getModels } from '@earendil-works/pi-ai';

describe('AiConfigurationService - Runner Config Resolution', () => {
  let ctx: AiConfigTestContext;

  beforeEach(async () => {
    ctx = await createAiConfigTestingModuleWithDefaults();
  });

  describe('resolveRunnerProviderConfig', () => {
    it('resolves runner provider config with explicit field names from runtime env', async () => {
      ctx.llmProviderRepository.findByName.mockImplementation((name: string) =>
        Promise.resolve(
          name === 'custom-minimax'
            ? createMockCustomMinimaxProviderFixture()
            : null,
        ),
      );

      ctx.llmModelRepository.findByName.mockResolvedValue(
        createMockLegacyModelFixture(),
      );

      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockLegacySecretStoreFixture(),
      );

      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify(MOCK_SECRET_PAYLOADS.legacy),
      );

      const resolved = await ctx.service.resolveRunnerProviderConfig({
        modelName: 'minimax-model',
        providerName: 'custom-minimax',
      });

      const legacyCredential =
        MOCK_SECRET_PAYLOADS.legacy.CUSTOM_MINIMAX_API_KEY;

      expect(resolved).toEqual({
        provider: 'minimax',
        apiKey: legacyCredential,
        auth: { type: 'api_key', apiKey: legacyCredential },
        baseUrl: 'https://llm.chutes.ai/v1',
        providerEnv: {
          pi_provider: 'minimax',
          api_key_field: 'CUSTOM_MINIMAX_API_KEY',
          base_url_field: 'CUSTOM_MINIMAX_BASE_URL',
          CUSTOM_MINIMAX_API_KEY: legacyCredential,
          CUSTOM_MINIMAX_BASE_URL: 'https://llm.chutes.ai/v1/',
        },
      });
    });

    it('resolves provider-scoped API key without hardcoded provider aliases', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockMinimaxProviderFixture(),
      );

      ctx.llmModelRepository.findByName.mockResolvedValue(
        createMockMinimaxModelFixture(),
      );

      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockMinimaxSecretStoreFixture(),
      );

      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify(MOCK_SECRET_PAYLOADS.minimax),
      );

      const resolved = await ctx.service.resolveRunnerProviderConfig({
        modelName: 'MiniMax-M2.5',
        providerName: 'minimax',
      });

      const minimaxCredential = MOCK_SECRET_PAYLOADS.minimax.MINIMAX_API_KEY;

      expect(resolved.provider).toBe('minimax');
      expect(resolved.apiKey).toBe(minimaxCredential);
      expect(resolved.auth).toEqual({
        type: 'api_key',
        apiKey: minimaxCredential,
      });
    });

    it('resolves OAuth runner auth and provider registration config', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockCorporateOAuthProviderFixture(),
      );
      ctx.llmModelRepository.findByName.mockResolvedValue(
        createMockCorporateOAuthModelFixture(),
      );
      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockCorporateOAuthSecretStoreFixture(),
      );
      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify(MOCK_SECRET_PAYLOADS.corporateOauth),
      );

      const resolved = await ctx.service.resolveRunnerProviderConfig({
        modelName: 'corp-large',
        providerName: 'corporate-ai',
      });

      expect(resolved).toEqual({
        provider: 'corporate-ai',
        apiKey: '',
        auth: {
          type: 'oauth',
          credential: {
            type: 'oauth',
            refreshToken: 'fixtureRefreshCredential',
            accessToken: 'fixtureAccessCredential',
            expiresAt: 4102444800000,
          },
        },
        baseUrl: 'https://ai.corp.example/v1',
        providerConfig: MOCK_CORPORATE_PROVIDER_CONFIG,
        providerEnv: {},
      });
    });

    it('synthesizes providerConfig from pi-ai SDK when OAuth provider lacks runtime_env.providerConfig', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockOpenAiCodexOAuthProviderFixture(),
      );
      ctx.llmModelRepository.findByName.mockResolvedValue(
        createMockOpenAiCodexOAuthModelFixture(),
      );
      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockOpenAiCodexOAuthSecretStoreFixture(),
      );
      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify(MOCK_SECRET_PAYLOADS.openaiCodexOauth),
      );

      vi.mocked(getModels).mockReturnValue([
        {
          id: 'gpt-5.3-codex-spark',
          name: 'GPT-5.3 Codex Spark',
          api: 'openai-codex-responses',
          provider: 'openai-codex',
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
          provider: 'openai-codex',
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
          provider: 'openai-codex',
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
          provider: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api',
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
          contextWindow: 272000,
          maxTokens: 128000,
        },
      ] as ReturnType<typeof getModels>);

      const resolved = await ctx.service.resolveRunnerProviderConfig({
        modelName: 'gpt-5.5',
        providerName: 'ChatGPT Plus/Pro (Codex Subscription)',
      });

      expect(resolved.provider).toBe('ChatGPT Plus/Pro (Codex Subscription)');
      expect(resolved.apiKey).toBe('');
      expect(resolved.auth).toEqual({
        type: 'oauth',
        credential: {
          type: 'oauth',
          refreshToken: 'openai-codex-refresh',
          accessToken: 'openai-codex-access',
          expiresAt: 4102444800000,
        },
      });
      expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api');
      expect(resolved.providerConfig).toEqual(
        MOCK_OPENAI_CODEX_PROVIDER_CONFIG,
      );
      expect(resolved.providerEnv).toEqual({ pi_provider: 'openai-codex' });
    });

    it('fails fast when an OAuth provider is missing credentials', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockCorporateOAuthProviderFixture(),
      );
      ctx.llmModelRepository.findByName.mockResolvedValue(
        createMockCorporateOAuthModelFixture(),
      );
      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockCorporateOAuthSecretStoreFixture(),
      );
      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify({ oauth: {} }),
      );

      await expect(
        ctx.service.resolveRunnerProviderConfig({
          modelName: 'corp-large',
          providerName: 'corporate-ai',
        }),
      ).rejects.toThrow(
        "OAuth provider 'corporate-ai' is missing credential field(s): refreshToken, accessToken, expiresAt",
      );
    });
  });
});
