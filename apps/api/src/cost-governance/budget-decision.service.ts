import { Injectable, Logger } from '@nestjs/common';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';
import { BudgetDecisionEventRepository } from './database/repositories/budget-decision-event.repository';
import { CostEstimatorService } from './cost-estimator.service';
import type {
  EvaluateActionInput,
  EvaluateActionResult,
  LatestBudgetDecisionDto,
} from './types/budget-decision.types';
import type { BudgetDecisionOutcome } from './types/budget-scope.types';
import type { BudgetPolicy } from './database/entities/budget-policy.entity';
import type { CostEstimateResult } from './types/cost-estimate.types';

const DECISION_RANK: Record<string, number> = {
  observe: 0,
  allow: 0,
  warn: 1,
  approval_required: 2,
  throttle: 3,
  block: 4,
  deny: 4,
};

function resolveWindowStart(window: string): Date {
  const now = new Date();
  switch (window) {
    case 'daily':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'weekly': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(now.getFullYear(), now.getMonth(), diff);
    }
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'per_run':
      return new Date(0);
    case 'rolling':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    default:
      return new Date(0);
  }
}

@Injectable()
export class BudgetDecisionService {
  private readonly logger = new Logger(BudgetDecisionService.name);

  constructor(
    private readonly policyService: BudgetPolicyService,
    private readonly usageRepo: BudgetUsageEventRepository,
    private readonly decisionRepo: BudgetDecisionEventRepository,
    private readonly estimator: CostEstimatorService,
  ) {}

  async evaluateAction(
    input: EvaluateActionInput,
  ): Promise<EvaluateActionResult> {
    const activePolicies = await this.loadRelevantPolicies(input);
    const estimate = await this.estimator.estimate({
      providerName: input.providerName ?? '',
      modelName: input.modelName ?? '',
      expectedInputTokens: input.expectedTokens,
      expectedOutputTokens: null,
      expectedTotalTokens: null,
    });

    const windowStart = resolveWindowStart('daily');
    const currentSpend = await this.usageRepo.getSpendInWindow(
      input.scopeId,
      input.contextId,
      windowStart,
    );

    let worstOutcome: BudgetDecisionOutcome = 'allow';
    let matchingPolicyId: string | null = null;
    let reasonCode = 'no_active_policy';

    for (const policy of activePolicies) {
      const decision = this.evaluatePolicy(
        input,
        policy,
        estimate,
        currentSpend.totalCents,
      );
      if (DECISION_RANK[decision.outcome] > DECISION_RANK[worstOutcome]) {
        worstOutcome = decision.outcome;
        matchingPolicyId = policy.id;
        reasonCode = decision.reasonCode;
      }
    }

    const remainingBudget = this.computeRemainingBudget(
      estimate.estimatedCents,
      currentSpend.totalCents,
    );

    await this.decisionRepo.recordDecision({
      correlation_id: input.correlationId,
      policy_id: matchingPolicyId,
      scope_id: input.scopeId,
      context_type: input.contextType,
      context_id: input.contextId,
      action_type: input.actionType,
      decision: worstOutcome,
      reason_code: reasonCode,
      estimated_cost_cents: estimate.estimatedCents,
      remaining_budget_cents: remainingBudget,
      metadata: null,
    });

    return {
      decision: worstOutcome,
      reasonCode,
      matchingPolicyId,
      estimatedCostCents: estimate.estimatedCents,
      remainingBudgetCents: remainingBudget,
      approvalRequired:
        worstOutcome === 'approval_required' || worstOutcome === 'deny',
    };
  }

  async getLatestDecision(
    contextType: 'chat_session' | 'workflow_run',
    contextId: string,
  ): Promise<LatestBudgetDecisionDto | null> {
    const event = await this.decisionRepo.findLatestByContext(
      contextType,
      contextId,
    );
    if (!event) return null;
    return {
      decision: event.decision as BudgetDecisionOutcome,
      reasonCode: event.reason_code,
      estimatedCostCents: event.estimated_cost_cents,
      remainingBudgetCents: event.remaining_budget_cents,
    };
  }

  private async loadRelevantPolicies(
    input: EvaluateActionInput,
  ): Promise<BudgetPolicy[]> {
    const policies = await this.policyService.listAll();
    return policies.filter((p) => {
      if (p.scope_id && p.scope_id !== input.scopeId) return false;
      if (p.context_type && p.context_type !== input.contextType) return false;
      if (p.context_id && p.context_id !== input.contextId) return false;
      if (p.provider_name && p.provider_name !== input.providerName)
        return false;
      if (p.model_name && p.model_name !== input.modelName) return false;
      return true;
    });
  }

  private evaluatePolicy(
    input: EvaluateActionInput,
    policy: BudgetPolicy,
    estimate: CostEstimateResult,
    currentSpendCents: number,
  ): { outcome: BudgetDecisionOutcome; reasonCode: string } {
    if (policy.token_limit !== null) {
      const tokens = input.expectedTokens ?? 0;
      if (tokens > policy.token_limit) {
        return {
          outcome: this.mapEnforcement(policy.enforcement_mode),
          reasonCode: 'token_limit_exceeded',
        };
      }
    }

    if (policy.hard_limit_cents !== null && estimate.estimatedCents !== null) {
      if (
        currentSpendCents + estimate.estimatedCents >
        policy.hard_limit_cents
      ) {
        return { outcome: 'deny', reasonCode: 'hard_limit_exceeded' };
      }
    }

    if (policy.soft_limit_cents !== null && estimate.estimatedCents !== null) {
      if (estimate.estimatedCents > policy.soft_limit_cents) {
        return {
          outcome: this.mapEnforcement(policy.enforcement_mode),
          reasonCode: 'soft_limit_exceeded',
        };
      }
    }

    return { outcome: 'allow', reasonCode: 'within_budget' };
  }

  private mapEnforcement(enforcementMode: string): BudgetDecisionOutcome {
    switch (enforcementMode) {
      case 'observe':
        return 'allow';
      case 'warn':
        return 'warn';
      case 'approval_required':
        return 'approval_required';
      case 'block':
        return 'deny';
      default:
        return 'allow';
    }
  }

  private computeRemainingBudget(
    estimatedCents: number | null,
    currentSpendCents: number,
  ): number | null {
    if (estimatedCents === null) return null;
    return Math.max(0, currentSpendCents - estimatedCents);
  }
}
