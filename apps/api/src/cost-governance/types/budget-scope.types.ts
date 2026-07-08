export type BudgetScopeType =
  | 'global'
  | 'scope'
  | 'context'
  | 'workflow_definition'
  | 'agent_profile'
  | 'provider'
  | 'model';

export type EnforcementMode =
  | 'observe'
  | 'warn'
  | 'approval_required'
  | 'block';

export type ResetWindow =
  | 'per_run'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'rolling';

export type BudgetDecisionActionType =
  | 'chat_turn'
  | 'workflow_launch'
  | 'step_execution'
  | 'agent_dispatch'
  | 'subagent_spawn'
  | 'tool_call';

export type BudgetDecisionOutcome =
  | 'allow'
  | 'warn'
  | 'approval_required'
  | 'throttle'
  | 'deny';

export type ActorType = 'user' | 'agent' | 'workflow' | 'subagent' | 'system';

export type EstimateSource =
  | 'model_rate'
  | 'provider_usage'
  | 'manual'
  | 'unknown';

export type ContextType = 'workflow_run' | 'chat_session';
