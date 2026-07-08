/**
 * TDD: EmbeddingProviderService
 *
 * All HTTP calls are replaced with a spy so no network traffic is made.
 * The adapter registry is left intact; tests exercise the default
 * OpenAI-compatible path.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { EmbeddingProviderService } from './embedding-provider.service';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { BudgetUsageEventRepository } from '../../cost-governance/database/repositories/budget-usage-event.repository';
import type { ResolvedEmbeddingModelConfig } from '../../ai-config/ai-configuration.service.types';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const CONFIGURED_MODEL: ResolvedEmbeddingModelConfig & { configured: true } = {
  configured: true,
  modelId: 'model-uuid-1',
  modelName: 'text-embedding-3-small',
  provider: 'openai',
  auth: { type: 'api_key', apiKey: 'sk-test' },
  baseUrl: 'https://api.openai.com/v1',
  embeddingDimension: 3,
  providerEnv: {},
};

function makeOpenAiSuccessResponse(
  vectors: number[][],
  inputTexts: string[],
): object {
  return {
    object: 'list',
    data: vectors.map((embedding, index) => ({
      object: 'embedding',
      embedding,
      index,
    })),
    model: 'text-embedding-3-small',
    usage: {
      prompt_tokens: inputTexts.length * 5,
      total_tokens: inputTexts.length * 5,
    },
  };
}

// ── Mock factories ────────────────────────────────────────────────────────────

function makeAiConfigMock(
  config: ResolvedEmbeddingModelConfig,
): Partial<AiConfigurationService> {
  return {
    resolveEmbeddingModelConfig: vi.fn().mockResolvedValue(config),
  };
}

function makeBudgetRepoMock(): Partial<BudgetUsageEventRepository> {
  return {
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildModule(
  aiConfig: Partial<AiConfigurationService>,
  budgetRepo: Partial<BudgetUsageEventRepository>,
): Promise<{ module: TestingModule; service: EmbeddingProviderService }> {
  const module = await Test.createTestingModule({
    providers: [
      EmbeddingProviderService,
      { provide: AiConfigurationService, useValue: aiConfig },
      { provide: BudgetUsageEventRepository, useValue: budgetRepo },
    ],
  }).compile();

  const service = module.get(EmbeddingProviderService);
  return { module, service };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmbeddingProviderService', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when no active model is configured', () => {
    it('returns { configured: false } and makes zero HTTP calls', async () => {
      const { service } = await buildModule(
        makeAiConfigMock({ configured: false }),
        makeBudgetRepoMock(),
      );

      const result = await service.embed(['hello world']);

      expect(result).toEqual({ configured: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns { configured: false } for an empty texts array', async () => {
      const { service } = await buildModule(
        makeAiConfigMock({ configured: false }),
        makeBudgetRepoMock(),
      );

      const result = await service.embed([]);

      expect(result).toEqual({ configured: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('when a model is configured', () => {
    it('posts { model, input } to {baseUrl}/embeddings and returns vectors with modelId and dim', async () => {
      const texts = ['foo', 'bar'];
      const expectedVectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];

      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue(makeOpenAiSuccessResponse(expectedVectors, texts)),
      });

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        makeBudgetRepoMock(),
      );

      const result = await service.embed(texts);

      expect(result.configured).toBe(true);
      if (!result.configured) {
        throw new Error('Expected configured:true');
      }
      expect(result.modelId).toBe('model-uuid-1');
      expect(result.dim).toBe(3);
      expect(result.vectors).toEqual(expectedVectors);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 3,
      });
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer sk-test');
    });

    it('omits the dimensions param when embeddingDimension is null', async () => {
      const configWithoutDim: ResolvedEmbeddingModelConfig = {
        ...CONFIGURED_MODEL,
        embeddingDimension: null,
      };
      const texts = ['hello'];
      const vectors = [[0.1, 0.2, 0.3]];

      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue(makeOpenAiSuccessResponse(vectors, texts)),
      });

      const { service } = await buildModule(
        makeAiConfigMock(configWithoutDim),
        makeBudgetRepoMock(),
      );

      await service.embed(texts);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).not.toHaveProperty('dimensions');
    });

    it('returns { configured: false } (no throw) when the HTTP call fails', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        makeBudgetRepoMock(),
      );

      const result = await service.embed(['some text']);

      expect(result).toEqual({ configured: false });
      // Should not re-throw
    });

    it('returns { configured: false } (no throw) when the provider returns a non-OK status', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        makeBudgetRepoMock(),
      );

      const result = await service.embed(['hello']);

      expect(result).toEqual({ configured: false });
    });

    it('returns { configured: false } and warns when returned vector length mismatches embeddingDimension', async () => {
      const texts = ['foo'];
      // Provider returns dim=5 but config expects dim=3
      const badVectors = [[0.1, 0.2, 0.3, 0.4, 0.5]];

      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue(makeOpenAiSuccessResponse(badVectors, texts)),
      });

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        makeBudgetRepoMock(),
      );

      const result = await service.embed(texts);

      expect(result).toEqual({ configured: false });
    });

    it('records token spend without blocking the embed result', async () => {
      const texts = ['a'];
      const vectors = [[0.1, 0.2, 0.3]];
      const budgetRepo = makeBudgetRepoMock();

      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue(makeOpenAiSuccessResponse(vectors, texts)),
      });

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        budgetRepo,
      );

      const result = await service.embed(texts);

      // Give the fire-and-forget recordUsage promise time to settle.
      await Promise.resolve();

      expect(result.configured).toBe(true);
      expect(budgetRepo.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          context_type: 'embedding',
          model_name: 'text-embedding-3-small',
          model_id: 'model-uuid-1',
          provider_name: 'openai',
        }),
      );
    });

    it('does not throw when token spend recording fails', async () => {
      const texts = ['x'];
      const vectors = [[0.1, 0.2, 0.3]];
      const budgetRepo = makeBudgetRepoMock();
      (budgetRepo.recordUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('DB down'),
      );

      fetchSpy.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue(makeOpenAiSuccessResponse(vectors, texts)),
      });

      const { service } = await buildModule(
        makeAiConfigMock(CONFIGURED_MODEL),
        budgetRepo,
      );

      await expect(service.embed(texts)).resolves.toEqual(
        expect.objectContaining({ configured: true }),
      );
    });
  });
});
