import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { CostEstimatorService } from './cost-estimator.service';
import { LlmModelRepository } from '../ai-config/database/repositories/llm-model.repository';

describe('CostEstimatorService', () => {
  let service: CostEstimatorService;
  let mockLlmModelRepo: {
    findByName: ReturnType<typeof vi.fn>;
    findActiveByProviderAndName: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockLlmModelRepo = {
      findByName: vi.fn().mockResolvedValue(null),
      findActiveByProviderAndName: vi.fn().mockResolvedValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [
        CostEstimatorService,
        { provide: LlmModelRepository, useValue: mockLlmModelRepo },
      ],
    }).compile();

    service = module.get(CostEstimatorService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns estimated cost when model has rates', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue({
      input_token_cents_per_million: 150,
      output_token_cents_per_million: 600,
    });

    const result = await service.estimate({
      providerName: 'anthropic',
      modelName: 'claude-3',
      expectedInputTokens: 100_000,
      expectedOutputTokens: 10_000,
      expectedTotalTokens: null,
    });

    expect(result.estimateSource).toBe('model_rate');
    expect(result.estimatedCents).toBe(21);
  });

  it('returns unknown when no rate is found', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue(null);

    const result = await service.estimate({
      providerName: 'unknown',
      modelName: 'unknown',
      expectedInputTokens: null,
      expectedOutputTokens: null,
      expectedTotalTokens: null,
    });

    expect(result.estimateSource).toBe('unknown');
    expect(result.estimatedCents).toBeNull();
    expect(result.rateMatched).toBeNull();
  });

  it('returns unknown when model has null rates', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue({
      id: 'model-1',
      name: 'gpt-4',
      input_token_cents_per_million: null,
      output_token_cents_per_million: null,
    });

    const result = await service.estimate({
      providerName: 'openai',
      modelName: 'gpt-4',
      expectedInputTokens: 100_000,
      expectedOutputTokens: 10_000,
      expectedTotalTokens: null,
    });

    expect(result.estimateSource).toBe('unknown');
    expect(result.estimatedCents).toBeNull();
    expect(result.rateMatched).toBeNull();
  });

  it('returns unknown when token estimates are null even with rate', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue({
      input_token_cents_per_million: 150,
      output_token_cents_per_million: 600,
    });

    const result = await service.estimate({
      providerName: 'anthropic',
      modelName: 'claude-3',
      expectedInputTokens: null,
      expectedOutputTokens: null,
      expectedTotalTokens: null,
    });

    expect(result.estimateSource).toBe('unknown');
    expect(result.estimatedCents).toBeNull();
  });

  it('resolves the rate by provider and name, disambiguating duplicate model names across providers', async () => {
    // Same model name exists under another provider with a different (cheaper)
    // rate; name-only resolution could pick the wrong one.
    mockLlmModelRepo.findByName.mockResolvedValue({
      id: 'other-row',
      input_token_cents_per_million: 1,
      output_token_cents_per_million: 2,
    });
    mockLlmModelRepo.findActiveByProviderAndName.mockResolvedValue({
      id: 'deepseek-row',
      input_token_cents_per_million: 44,
      output_token_cents_per_million: 87,
    });

    const result = await service.estimate({
      providerName: 'deepseek',
      modelName: 'shared-model-name',
      expectedInputTokens: 1_000_000,
      expectedOutputTokens: 1_000_000,
      expectedTotalTokens: null,
    });

    expect(mockLlmModelRepo.findActiveByProviderAndName).toHaveBeenCalledWith(
      'deepseek',
      'shared-model-name',
    );
    expect(mockLlmModelRepo.findByName).not.toHaveBeenCalled();
    expect(result.estimateSource).toBe('model_rate');
    expect(result.estimatedCents).toBe(131);
    expect(result.modelId).toBe('deepseek-row');
  });

  it('falls back to name-only lookup when no provider is supplied', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue({
      id: 'name-only-row',
      input_token_cents_per_million: 150,
      output_token_cents_per_million: 600,
    });

    const result = await service.estimate({
      providerName: '',
      modelName: 'claude-3',
      expectedInputTokens: 100_000,
      expectedOutputTokens: 10_000,
      expectedTotalTokens: null,
    });

    expect(mockLlmModelRepo.findByName).toHaveBeenCalledWith('claude-3');
    expect(result.estimateSource).toBe('model_rate');
    expect(result.modelId).toBe('name-only-row');
  });

  it('exposes a null model id when no model row matches', async () => {
    const result = await service.estimate({
      providerName: 'ghost',
      modelName: 'ghost',
      expectedInputTokens: 100,
      expectedOutputTokens: 100,
      expectedTotalTokens: null,
    });

    expect(result.modelId).toBeNull();
  });

  it('estimates from total tokens when provider usage does not split input and output tokens', async () => {
    mockLlmModelRepo.findByName.mockResolvedValue({
      input_token_cents_per_million: 15,
      output_token_cents_per_million: 60,
    });

    const input = {
      providerName: 'minimax',
      modelName: 'MiniMax-M3',
      expectedInputTokens: null,
      expectedOutputTokens: null,
      expectedTotalTokens: 57_856,
    } satisfies Parameters<CostEstimatorService['estimate']>[0] & {
      expectedTotalTokens: number;
    };

    const result = await service.estimate(input);

    expect(result.estimateSource).toBe('model_rate');
    expect(result.estimatedCents).toBe(1);
  });
});
