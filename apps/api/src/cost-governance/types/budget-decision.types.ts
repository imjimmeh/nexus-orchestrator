import type {
  BudgetScopeType,
  EnforcementMode,
  ResetWindow,
  BudgetDecisionActionType,
  BudgetDecisionOutcome,
  ActorType,
  EstimateSource,
  ContextType,
} from './budget-scope.types';

export type BudgetPolicyScope = {
  scopeType: BudgetScopeType;
  scopeId: string | null;
  contextType: ContextType | null;
  contextId: string | null;
  providerName: string | null;
  modelName: string | null;
};

export type BudgetPolicyLimits = {
  softLimitCents: number | null;
  hardLimitCents: number | null;
  tokenLimit: number | null;
  window: ResetWindow;
};

export type BudgetPolicyConfig = BudgetPolicyScope &
  BudgetPolicyLimits & {
    name: string;
    enforcementMode: EnforcementMode;
    isActive: boolean;
  };

export type EvaluateActionInput = {
  scopeId: string | null;
  contextType: ContextType;
  contextId: string;
  actionType: BudgetDecisionActionType;
  actorType: ActorType;
  actorId: string | null;
  providerName: string | null;
  modelName: string | null;
  expectedTokens: number | null;
  correlationId: string;
};

export type EvaluateActionResult = {
  decision: BudgetDecisionOutcome;
  reasonCode: string;
  matchingPolicyId: string | null;
  estimatedCostCents: number | null;
  remainingBudgetCents: number | null;
  approvalRequired: boolean;
};

export type BudgetUsageEventInput = {
  correlationId: string | null;
  scopeId: string | null;
  contextType: ContextType;
  contextId: string;
  actorType: ActorType;
  actorId: string | null;
  providerName: string | null;
  modelName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostCents: number | null;
  estimateSource: EstimateSource;
  metadata: Record<string, unknown> | null;
};

export interface LatestBudgetDecisionDto {
  decision: BudgetDecisionOutcome;
  reasonCode: string;
  estimatedCostCents: number | null;
  remainingBudgetCents: number | null;
}
