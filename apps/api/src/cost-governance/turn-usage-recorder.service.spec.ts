import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { TurnUsageRecorderService } from './turn-usage-recorder.service';
import { CostEstimatorService } from './cost-estimator.service';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';

describe('TurnUsageRecorderService', () => {
  let service: TurnUsageRecorderService;
  let mockEstimator: { estimate: ReturnType<typeof vi.fn> };
  let mockRepo: { recordUsage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockEstimator = {
      estimate: vi.fn().mockResolvedValue({
        estimatedCents: 3,
        estimateSource: 'model_rate',
        rateMatched: null,
        modelId: 'model-uuid-1',
      }),
    };
    mockRepo = { recordUsage: vi.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        TurnUsageRecorderService,
        { provide: CostEstimatorService, useValue: mockEstimator },
        { provide: BudgetUsageEventRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(TurnUsageRecorderService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records a priced budget event for a turn that consumed tokens', async () => {
    await service.recordTurnUsage({
      contextType: 'workflow_run',
      contextId: 'run-1',
      scopeId: null,
      providerName: 'deepseek',
      modelName: 'deepseek-v4-pro',
      stepId: 'session',
      usage: { input: 692, output: 110, totalTokens: 3746 },
    });

    expect(mockEstimator.estimate).toHaveBeenCalledWith({
      providerName: 'deepseek',
      modelName: 'deepseek-v4-pro',
      expectedInputTokens: 692,
      expectedOutputTokens: 110,
      expectedTotalTokens: 3746,
    });
    expect(mockRepo.recordUsage).toHaveBeenCalledTimes(1);
    expect(mockRepo.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        context_type: 'workflow_run',
        context_id: 'run-1',
        correlation_id: 'run-1',
        provider_name: 'deepseek',
        model_name: 'deepseek-v4-pro',
        model_id: 'model-uuid-1',
        input_tokens: 692,
        output_tokens: 110,
        total_tokens: 3746,
        estimated_cost_cents: 3,
        estimate_source: 'model_rate',
      }),
    );
  });

  it('skips turns that carried no token usage (e.g. a terminal turn with no usage)', async () => {
    await service.recordTurnUsage({
      contextType: 'workflow_run',
      contextId: 'run-1',
      scopeId: null,
      providerName: 'deepseek',
      modelName: 'deepseek-v4-pro',
      stepId: 'session',
      usage: undefined,
    });

    expect(mockRepo.recordUsage).not.toHaveBeenCalled();
    expect(mockEstimator.estimate).not.toHaveBeenCalled();
  });

  it('still records token counts as unpriced when provider/model are unknown', async () => {
    await service.recordTurnUsage({
      contextType: 'workflow_run',
      contextId: 'run-1',
      scopeId: null,
      providerName: null,
      modelName: null,
      stepId: null,
      usage: { input: 50, output: 20, totalTokens: 70 },
    });

    expect(mockEstimator.estimate).not.toHaveBeenCalled();
    expect(mockRepo.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_name: null,
        model_name: null,
        model_id: null,
        input_tokens: 50,
        output_tokens: 20,
        total_tokens: 70,
        estimated_cost_cents: null,
        estimate_source: 'unknown',
      }),
    );
  });

  it('tags chat-session turns with the chat context type', async () => {
    await service.recordTurnUsage({
      contextType: 'chat',
      contextId: 'chat-1',
      scopeId: 'scope-9',
      providerName: 'deepseek',
      modelName: 'deepseek-v4-pro',
      stepId: null,
      usage: { input: 10, output: 5, totalTokens: 15 },
    });

    expect(mockRepo.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        context_type: 'chat',
        context_id: 'chat-1',
        scope_id: 'scope-9',
      }),
    );
  });

  it('never throws when the repository fails (best-effort recording)', async () => {
    mockRepo.recordUsage.mockRejectedValue(new Error('db down'));

    await expect(
      service.recordTurnUsage({
        contextType: 'workflow_run',
        contextId: 'run-1',
        scopeId: null,
        providerName: 'deepseek',
        modelName: 'deepseek-v4-pro',
        stepId: 'session',
        usage: { input: 1, output: 1, totalTokens: 2 },
      }),
    ).resolves.toBeUndefined();
  });
});
