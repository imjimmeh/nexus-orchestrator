import { describe, it, expect } from 'vitest';
import type {
  BudgetScopeType,
  EnforcementMode,
  ResetWindow,
  BudgetDecisionActionType,
} from './budget-scope.types';

describe('BudgetScopeType', () => {
  it('accepts valid scope type literals', () => {
    const valid: BudgetScopeType[] = [
      'global',
      'scope',
      'context',
      'workflow_definition',
      'agent_profile',
      'provider',
      'model',
    ];
    expect(valid).toHaveLength(7);
  });
});

describe('EnforcementMode', () => {
  it('accepts valid enforcement mode literals', () => {
    const valid: EnforcementMode[] = [
      'observe',
      'warn',
      'approval_required',
      'block',
    ];
    expect(valid).toHaveLength(4);
  });
});

describe('ResetWindow', () => {
  it('accepts valid reset window literals', () => {
    const valid: ResetWindow[] = [
      'per_run',
      'daily',
      'weekly',
      'monthly',
      'rolling',
    ];
    expect(valid).toHaveLength(5);
  });
});

describe('BudgetDecisionActionType', () => {
  it('accepts valid action type literals', () => {
    const valid: BudgetDecisionActionType[] = [
      'chat_turn',
      'workflow_launch',
      'step_execution',
      'agent_dispatch',
      'subagent_spawn',
      'tool_call',
    ];
    expect(valid).toHaveLength(6);
  });
});
