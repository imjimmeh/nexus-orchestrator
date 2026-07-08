import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BudgetDecisionService } from './budget-decision.service';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';
import { BudgetDecisionEventRepository } from './database/repositories/budget-decision-event.repository';
import { CostEstimatorService } from './cost-estimator.service';

describe('BudgetDecisionService', () => {
  let service: BudgetDecisionService;
  let mockPolicySvc: {
    listByScope: ReturnType<typeof vi.fn>;
    listAll: ReturnType<typeof vi.fn>;
  };
  let mockUsageRepo: { getSpendInWindow: ReturnType<typeof vi.fn> };
  let mockDecisionRepo: {
    recordDecision: ReturnType<typeof vi.fn>;
    findLatestByContext: ReturnType<typeof vi.fn>;
  };
  let mockEstimator: { estimate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockPolicySvc = { listByScope: vi.fn(), listAll: vi.fn() };
    mockUsageRepo = { getSpendInWindow: vi.fn() };
    mockDecisionRepo = {
      recordDecision: vi.fn(),
      findLatestByContext: vi.fn().mockResolvedValue(null),
    };
    mockEstimator = { estimate: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        BudgetDecisionService,
        { provide: BudgetPolicyService, useValue: mockPolicySvc },
        { provide: BudgetUsageEventRepository, useValue: mockUsageRepo },
        { provide: BudgetDecisionEventRepository, useValue: mockDecisionRepo },
        { provide: CostEstimatorService, useValue: mockEstimator },
      ],
    }).compile();

    service = module.get(BudgetDecisionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const evaluateInput = {
    scopeId: null,
    contextType: 'workflow_run' as const,
    contextId: 'run-1',
    actionType: 'step_execution' as const,
    actorType: 'agent' as const,
    actorId: null,
    providerName: 'anthropic',
    modelName: 'claude-3',
    expectedTokens: 1000,
    correlationId: 'corr-1',
  };

  it('returns allow when no active policies', async () => {
    mockPolicySvc.listAll.mockResolvedValue([]);
    mockPolicySvc.listByScope.mockResolvedValue([]);
    mockEstimator.estimate.mockResolvedValue({
      estimatedCents: null,
      estimateSource: 'unknown',
      rateMatched: null,
    });
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 0,
      totalTokens: 0,
    });
    mockDecisionRepo.recordDecision.mockResolvedValue({ id: 'd1' } as any);

    const result = await service.evaluateAction(evaluateInput);

    expect(result.decision).toBe('allow');
    expect(result.approvalRequired).toBe(false);
  });

  it('returns warn when soft limit exceeded', async () => {
    mockPolicySvc.listAll.mockResolvedValue([
      {
        id: 'p1',
        enforcement_mode: 'warn',
        soft_limit_cents: 100,
        hard_limit_cents: null,
        token_limit: null,
        window: 'daily',
        is_active: true,
        scope_type: 'global',
        scope_id: null,
        provider_name: null,
        model_name: null,
        context_type: null,
        context_id: null,
      },
    ] as any);
    mockPolicySvc.listByScope.mockResolvedValue([]);

    mockEstimator.estimate.mockResolvedValue({
      estimatedCents: 200,
      estimateSource: 'model_rate',
      rateMatched: {} as any,
    });
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 0,
      totalTokens: 0,
    });
    mockDecisionRepo.recordDecision.mockResolvedValue({ id: 'd1' } as any);

    const result = await service.evaluateAction(evaluateInput);

    expect(result.decision).toBe('warn');
    expect(result.matchingPolicyId).toBe('p1');
  });

  it('returns deny when hard limit exceeded', async () => {
    mockPolicySvc.listAll.mockResolvedValue([
      {
        id: 'p1',
        enforcement_mode: 'block',
        hard_limit_cents: 500,
        soft_limit_cents: null,
        token_limit: null,
        window: 'daily',
        is_active: true,
        scope_type: 'global',
        scope_id: null,
        provider_name: null,
        model_name: null,
        context_type: null,
        context_id: null,
      },
    ] as any);
    mockPolicySvc.listByScope.mockResolvedValue([]);

    mockEstimator.estimate.mockResolvedValue({
      estimatedCents: 100,
      estimateSource: 'model_rate',
      rateMatched: {} as any,
    });
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 450,
      totalTokens: 0,
    });
    mockDecisionRepo.recordDecision.mockResolvedValue({ id: 'd1' } as any);

    const result = await service.evaluateAction(evaluateInput);

    expect(result.decision).toBe('deny');
  });

  it('returns most restrictive decision when multiple policies match (block > warn)', async () => {
    mockPolicySvc.listAll.mockResolvedValue([
      {
        id: 'p1',
        enforcement_mode: 'warn',
        hard_limit_cents: null,
        window: 'daily',
        is_active: true,
        scope_type: 'global',
        scope_id: null,
        provider_name: null,
        model_name: null,
        token_limit: null,
        soft_limit_cents: 100,
        context_type: null,
        context_id: null,
      },
      {
        id: 'p2',
        enforcement_mode: 'block',
        hard_limit_cents: 500,
        window: 'daily',
        is_active: true,
        scope_type: 'global',
        scope_id: null,
        provider_name: null,
        model_name: null,
        token_limit: null,
        soft_limit_cents: null,
        context_type: null,
        context_id: null,
      },
    ] as any);
    mockPolicySvc.listByScope.mockResolvedValue([]);

    mockEstimator.estimate.mockResolvedValue({
      estimatedCents: 100,
      estimateSource: 'model_rate',
      rateMatched: {} as any,
    });
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 450,
      totalTokens: 0,
    });
    mockDecisionRepo.recordDecision.mockResolvedValue({ id: 'd1' } as any);

    const result = await service.evaluateAction(evaluateInput);

    expect(result.decision).toBe('deny');
  });

  describe('getLatestDecision', () => {
    it('returns null when no decision event exists for the context', async () => {
      mockDecisionRepo.findLatestByContext.mockResolvedValue(null);

      const result = await service.getLatestDecision('chat_session', 'sess-1');

      expect(result).toBeNull();
      expect(mockDecisionRepo.findLatestByContext).toHaveBeenCalledWith(
        'chat_session',
        'sess-1',
      );
    });

    it('maps a decision event to LatestBudgetDecisionDto', async () => {
      mockDecisionRepo.findLatestByContext.mockResolvedValue({
        decision: 'warn',
        reason_code: 'soft_limit_exceeded',
        estimated_cost_cents: 150,
        remaining_budget_cents: 50,
      });

      const result = await service.getLatestDecision('workflow_run', 'run-1');

      expect(result).toEqual({
        decision: 'warn',
        reasonCode: 'soft_limit_exceeded',
        estimatedCostCents: 150,
        remainingBudgetCents: 50,
      });
    });
  });
});
