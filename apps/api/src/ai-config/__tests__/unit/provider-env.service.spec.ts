import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiConfigTestingModuleWithDefaults } from '../setup/ai-config-test.module';
import { AiConfigTestContext } from '../setup/ai-config-test.module';
import {
  createMockOpenAiProviderFixture,
  createMockProviderWithEmptyRuntimeEnvFixture,
  createMockSecretStoreFixture,
  createMockSecretStoreWithJsonPayloadFixture,
  MOCK_SECRET_PAYLOADS,
} from '../setup/ai-config-test.fixtures';

describe('AiConfigurationService - Provider Environment', () => {
  let ctx: AiConfigTestContext;

  beforeEach(async () => {
    ctx = await createAiConfigTestingModuleWithDefaults();
  });

  describe('buildProviderEnvByName', () => {
    it('builds provider env from runtime env and decrypted secret payload', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockOpenAiProviderFixture(),
      );
      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockSecretStoreFixture(),
      );
      ctx.secretVaultService.decrypt.mockReturnValue(
        JSON.stringify(MOCK_SECRET_PAYLOADS.openai),
      );

      const env = await ctx.service.buildProviderEnvByName('openai');

      expect(env).toEqual({
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        ENABLED: 'true',
        OPENAI_API_KEY: 'fixtureOpenAiCredential',
        TOKEN_TTL: '3600',
      });
      expect(env.OBJECT_VALUE).toBeUndefined();
    });

    it('supports plain JSON secret payload fallback when decrypt fails', async () => {
      ctx.llmProviderRepository.findByName.mockResolvedValue(
        createMockProviderWithEmptyRuntimeEnvFixture(),
      );
      ctx.secretStoreRepository.findById.mockResolvedValue(
        createMockSecretStoreWithJsonPayloadFixture(),
      );
      ctx.secretVaultService.decrypt.mockImplementation(() => {
        throw new Error('decrypt failed');
      });

      const env = await ctx.service.buildProviderEnvByName('openai-plain');
      expect(env).toEqual({ OPENAI_API_KEY: 'plain-json-key' });
    });
  });
});
