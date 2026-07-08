import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BudgetDecisionEvent } from '../entities/budget-decision-event.entity';
import { BudgetDecisionEventRepository } from './budget-decision-event.repository';

describe('BudgetDecisionEventRepository', () => {
  let repo: BudgetDecisionEventRepository;
  let mockRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      create: vi.fn(),
      save: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        BudgetDecisionEventRepository,
        {
          provide: getRepositoryToken(BudgetDecisionEvent),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(BudgetDecisionEventRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recordDecision saves and returns the event', async () => {
    const input = {
      context_type: 'workflow_run',
      context_id: 'r1',
      decision: 'allow',
      reason_code: 'within_budget',
    };
    mockRepo.create.mockReturnValue(input);
    mockRepo.save.mockResolvedValue({ id: 'd1', ...input });

    const result = await repo.recordDecision(input);
    expect(result.id).toBe('d1');
  });

  it('findByContext returns paginated results', async () => {
    const result = await repo.findByContext('workflow_run', 'r1');
    expect(result).toEqual([]);
  });

  describe('findLatestByContext', () => {
    it('returns the most recent event when one exists', async () => {
      const event = {
        id: 'd1',
        context_type: 'chat_session',
        context_id: 'sess-1',
        decision: 'warn',
        reason_code: 'soft_limit_exceeded',
        estimated_cost_cents: 150,
        remaining_budget_cents: 50,
        created_at: new Date(),
      };
      mockRepo.find.mockResolvedValue([event]);

      const result = await repo.findLatestByContext('chat_session', 'sess-1');

      expect(result).toEqual(event);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { context_type: 'chat_session', context_id: 'sess-1' },
        order: { created_at: 'DESC' },
        take: 1,
      });
    });

    it('returns null when no events exist for the context', async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await repo.findLatestByContext(
        'chat_session',
        'no-such-id',
      );

      expect(result).toBeNull();
    });
  });
});
