import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostGovernanceController } from './cost-governance.controller';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetDecisionService } from './budget-decision.service';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';
import { BudgetDecisionEventRepository } from './database/repositories/budget-decision-event.repository';
import { BudgetPolicyRepository } from './database/repositories/budget-policy.repository';
import type { CreateBudgetPolicyDto } from './dto/budget-policy.dto.types';
import type { EvaluateActionDto } from './dto/budget-query.dto.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';

describe('CostGovernanceController', () => {
  let controller: CostGovernanceController;

  const mockPolicyService = {
    create: vi.fn(),
    listAll: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    disable: vi.fn(),
  };

  const mockDecisionService = {
    evaluateAction: vi.fn(),
  };

  const mockUsageRepo = {
    recordUsage: vi.fn(),
    findByContext: vi.fn(),
    getSummary: vi.fn(),
  };

  const mockDecisionRepo = {
    findByContext: vi.fn(),
  };

  const mockPolicyRepo = {};

  const mockScopeAccess = {
    restrictToAccessibleScopes: vi
      .fn()
      .mockImplementation(
        async (
          _userId: string,
          _permission: string,
          requestedScopeId?: string,
        ) => (requestedScopeId ? [requestedScopeId] : []),
      ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockScopeAccess.restrictToAccessibleScopes.mockImplementation(
      async (
        _userId: string,
        _permission: string,
        requestedScopeId?: string,
      ) => (requestedScopeId ? [requestedScopeId] : []),
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CostGovernanceController],
      providers: [
        { provide: BudgetPolicyService, useValue: mockPolicyService },
        { provide: BudgetDecisionService, useValue: mockDecisionService },
        { provide: BudgetUsageEventRepository, useValue: mockUsageRepo },
        { provide: BudgetDecisionEventRepository, useValue: mockDecisionRepo },
        { provide: BudgetPolicyRepository, useValue: mockPolicyRepo },
        { provide: ScopeAccessService, useValue: mockScopeAccess },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CostGovernanceController>(CostGovernanceController);
  });

  describe('POST /cost-governance/policies', () => {
    it('creates a policy and returns it', async () => {
      const policyInput = {
        name: 'Test Policy',
        scope_type: 'global',
        scope_id: null,
        context_type: null,
        context_id: null,
        provider_name: null,
        model_name: null,
        soft_limit_cents: 1000,
        hard_limit_cents: 5000,
        token_limit: null,
        window: 'daily',
        enforcement_mode: 'warn',
        is_active: true,
      } satisfies CreateBudgetPolicyDto;

      const createdPolicy = {
        id: 'policy-1',
        ...policyInput,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPolicyService.create.mockResolvedValue(createdPolicy);

      const result = await controller.createPolicy(policyInput);

      expect(mockPolicyService.create).toHaveBeenCalledWith(policyInput);
      expect(result).toEqual(createdPolicy);
    });
  });

  describe('GET /cost-governance/policies', () => {
    it('lists policies confined to the caller accessible scope set when no scopeNodeId given', async () => {
      const policies = [
        { id: 'policy-1', name: 'Policy 1', is_active: true },
        { id: 'policy-2', name: 'Policy 2', is_active: true },
      ];
      mockPolicyService.listAll.mockResolvedValue(policies);
      mockScopeAccess.restrictToAccessibleScopes.mockResolvedValue(['team-a']);

      const result = await controller.listPolicies(undefined, {
        user: { userId: 'user-1' },
      });

      expect(mockScopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
        'user-1',
        'budgets:read',
        undefined,
      );
      expect(mockPolicyService.listAll).toHaveBeenCalledWith(['team-a']);
      expect(result).toEqual(policies);
    });

    it('confines to a single accessible scopeNodeId', async () => {
      mockPolicyService.listAll.mockResolvedValue([]);

      await controller.listPolicies('team-a', {
        user: { userId: 'user-1' },
      });

      expect(mockPolicyService.listAll).toHaveBeenCalledWith(['team-a']);
    });

    it('default-denies an out-of-subtree scopeNodeId', async () => {
      mockPolicyService.listAll.mockResolvedValue([]);
      mockScopeAccess.restrictToAccessibleScopes.mockResolvedValue([]);

      await controller.listPolicies('team-out-of-subtree', {
        user: { userId: 'user-1' },
      });

      expect(mockPolicyService.listAll).toHaveBeenCalledWith([]);
    });
  });

  describe('POST /cost-governance/evaluate', () => {
    it('delegates to decision service and returns result', async () => {
      const evalInput = {
        scope_id: null,
        context_type: 'workflow_run',
        context_id: 'ctx-123',
        action_type: 'step_execution',
        actor_type: 'agent',
        actor_id: 'agent-1',
        provider_name: 'openai',
        model_name: 'gpt-4',
        expected_tokens: 1000,
        correlation_id: 'corr-456',
      } satisfies EvaluateActionDto;

      const decisionResult = {
        decision: 'allow',
        reasonCode: 'within_budget',
        matchingPolicyId: null,
        estimatedCostCents: 3,
        remainingBudgetCents: null,
        approvalRequired: false,
      };
      mockDecisionService.evaluateAction.mockResolvedValue(decisionResult);

      const result = await controller.evaluateAction(evalInput);

      expect(mockDecisionService.evaluateAction).toHaveBeenCalledWith({
        scopeId: null,
        contextType: 'workflow_run',
        contextId: 'ctx-123',
        actionType: 'step_execution',
        actorType: 'agent',
        actorId: 'agent-1',
        providerName: 'openai',
        modelName: 'gpt-4',
        expectedTokens: 1000,
        correlationId: 'corr-456',
      });
      expect(result).toEqual(decisionResult);
    });
  });

  describe('GET /cost-governance/summary', () => {
    it('wraps summary rows in the API response envelope expected by clients', async () => {
      const rows = [
        {
          key: 'minimax',
          total_cents: '42',
          total_tokens: '1000',
          count: '1',
        },
      ];
      mockUsageRepo.getSummary.mockResolvedValue(rows);

      const result = await controller.getSummary({ group_by: 'provider' });

      expect(mockUsageRepo.getSummary).toHaveBeenCalledWith({
        scopeId: undefined,
        groupBy: 'provider',
        window: undefined,
        from: undefined,
        to: undefined,
      });
      expect(result).toEqual({ success: true, data: rows });
    });
  });
});
