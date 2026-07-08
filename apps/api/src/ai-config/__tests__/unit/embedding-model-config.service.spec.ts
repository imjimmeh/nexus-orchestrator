import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmModel } from '../../database/entities/llm-model.entity';
import { createAiConfigTestingModuleWithDefaults } from '../setup/ai-config-test.module';
import type { AiConfigTestContext } from '../setup/ai-config-test.module';

describe('LlmModel embedding fields contract', () => {
  it('has supports_embedding field', () => {
    const model = new LlmModel();
    expect('supports_embedding' in model).toBe(true);
  });

  it('has embedding_dimension field (nullable)', () => {
    const model = new LlmModel();
    expect('embedding_dimension' in model).toBe(true);
  });

  it('has default_for_embedding field', () => {
    const model = new LlmModel();
    expect('default_for_embedding' in model).toBe(true);
  });
});

describe('AiConfigurationService.resolveEmbeddingModelConfig', () => {
  let ctx: AiConfigTestContext;

  beforeEach(async () => {
    ctx = await createAiConfigTestingModuleWithDefaults();
  });

  it('returns { configured: false } when no default_for_embedding model exists', async () => {
    ctx.llmModelRepository.findDefaultForEmbedding = vi
      .fn()
      .mockResolvedValue(null);

    const result = await ctx.service.resolveEmbeddingModelConfig();

    expect(result).toEqual({ configured: false });
  });

  it('returns resolved config with embeddingDimension when active model exists', async () => {
    const embeddingModel = {
      id: 'embed-model-1',
      name: 'text-embedding-3-small',
      provider_name: 'voyage',
      token_limit: 8192,
      default_for_embedding: true,
      supports_embedding: true,
      embedding_dimension: 384,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as LlmModel;

    ctx.llmModelRepository.findDefaultForEmbedding = vi
      .fn()
      .mockResolvedValue(embeddingModel);

    ctx.llmProviderRepository.findByName = vi.fn().mockResolvedValue({
      id: 'provider-voyage',
      name: 'voyage',
      auth_type: 'api_key',
      secret_id: 'secret-voyage',
      runtime_env: {},
      is_active: true,
      oauth_authorization_url: null,
      oauth_token_url: null,
      oauth_client_id: null,
      oauth_client_secret_id: null,
      oauth_scopes: null,
      oauth_redirect_uri: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    ctx.secretStoreRepository.findById = vi.fn().mockResolvedValue({
      id: 'secret-voyage',
      name: 'voyage-secret',
      encrypted_value: JSON.stringify({ VOYAGE_API_KEY: 'test-voyage-key' }),
      metadata: {},
      owner_type: 'global',
      owner_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    ctx.secretVaultService.decrypt = vi
      .fn()
      .mockReturnValue(JSON.stringify({ VOYAGE_API_KEY: 'test-voyage-key' }));

    const result = await ctx.service.resolveEmbeddingModelConfig();

    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.modelId).toBe('embed-model-1');
      expect(result.modelName).toBe('text-embedding-3-small');
      expect(result.embeddingDimension).toBe(384);
      expect(result.provider).toBe('voyage');
    }
  });

  it('returns { configured: false } (not an error) when model exists but provider lookup fails', async () => {
    const embeddingModel = {
      id: 'embed-model-1',
      name: 'text-embedding-3-small',
      provider_name: 'missing-provider',
      token_limit: 8192,
      default_for_embedding: true,
      supports_embedding: true,
      embedding_dimension: 1536,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as LlmModel;

    ctx.llmModelRepository.findDefaultForEmbedding = vi
      .fn()
      .mockResolvedValue(embeddingModel);
    ctx.llmProviderRepository.findByName = vi.fn().mockResolvedValue(null);

    const result = await ctx.service.resolveEmbeddingModelConfig();

    expect(result).toEqual({ configured: false });
  });
});
