import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BudgetUsageEvent } from '../entities/budget-usage-event.entity';
import { BudgetUsageEventRepository } from './budget-usage-event.repository';

describe('BudgetUsageEventRepository', () => {
  let repo: BudgetUsageEventRepository;
  let mockRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      addGroupBy: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ totalCents: 0, totalTokens: 0 }),
      getRawMany: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
    };

    mockRepo = {
      create: vi.fn(),
      save: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        BudgetUsageEventRepository,
        { provide: getRepositoryToken(BudgetUsageEvent), useValue: mockRepo },
      ],
    }).compile();

    repo = module.get(BudgetUsageEventRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recordUsage saves and returns the event', async () => {
    const input = {
      context_type: 'workflow_run',
      context_id: 'r1',
      total_tokens: 500,
    };
    mockRepo.create.mockReturnValue(input);
    mockRepo.save.mockResolvedValue({ id: 'e1', ...input });

    const result = await repo.recordUsage(input);
    expect(result.id).toBe('e1');
  });

  it('getSpendInWindow returns aggregated total', async () => {
    const result = await repo.getSpendInWindow('global', null, new Date());
    expect(result).toBeDefined();
    expect(result.totalCents).toBe(0);
  });

  it('findByContext returns paginated results', async () => {
    const result = await repo.findByContext('workflow_run', 'r1');
    expect(result).toEqual([]);
  });

  it('getRunTotals sums token usage filtered by run context id', async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getRawOne.mockResolvedValueOnce({
      totalTokens: '1500',
      inputTokens: '1200',
      outputTokens: '300',
      estimatedCostCents: '12',
      pricedTurnCount: '403',
    });

    const result = await repo.getRunTotals('run-1');

    expect(queryBuilder.where).toHaveBeenCalledWith('e.context_id = :runId', {
      runId: 'run-1',
    });
    expect(result).toEqual({
      totalTokens: 1500,
      inputTokens: 1200,
      outputTokens: 300,
      estimatedCostCents: 12,
      pricedTurnCount: 403,
    });
  });

  it('getRunTotals returns zeroes when no usage is recorded', async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getRawOne.mockResolvedValueOnce(undefined);

    const result = await repo.getRunTotals('run-empty');

    expect(result).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostCents: 0,
      pricedTurnCount: 0,
    });
  });

  it('getRunTotalsByModel groups usage by model identifiers', async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getRawMany.mockResolvedValueOnce([
      {
        model_id: 'm1',
        provider_name: 'anthropic',
        model_name: 'claude-sonnet-5',
        input_tokens: '1200',
        output_tokens: '300',
        cost_cents: '12',
      },
      {
        model_id: 'm2',
        provider_name: 'openai',
        model_name: 'gpt-5',
        input_tokens: '100',
        output_tokens: '50',
        cost_cents: '3',
      },
    ]);

    const result = await repo.getRunTotalsByModel('run-1');

    expect(queryBuilder.where).toHaveBeenCalledWith('e.context_id = :runId', {
      runId: 'run-1',
    });
    expect(queryBuilder.addGroupBy).toHaveBeenCalledWith(
      'e.model_id, e.provider_name, e.model_name',
    );
    expect(result).toEqual([
      {
        model_id: 'm1',
        provider_name: 'anthropic',
        model_name: 'claude-sonnet-5',
        input_tokens: 1200,
        output_tokens: 300,
        cost_cents: 12,
      },
      {
        model_id: 'm2',
        provider_name: 'openai',
        model_name: 'gpt-5',
        input_tokens: 100,
        output_tokens: 50,
        cost_cents: 3,
      },
    ]);
  });

  it('getRunTotalsByModel returns an empty array when no usage is recorded', async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getRawMany.mockResolvedValueOnce([]);

    const result = await repo.getRunTotalsByModel('run-empty');

    expect(result).toEqual([]);
  });
});
