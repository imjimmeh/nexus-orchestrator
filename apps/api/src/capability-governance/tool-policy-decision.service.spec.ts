import { describe, expect, it } from 'vitest';
import { ToolPolicyDecisionService } from './tool-policy-decision.service';

describe('ToolPolicyDecisionService', () => {
  const service = new ToolPolicyDecisionService();

  it('denies when profile explicitly denies a tool alias', () => {
    const decision = service.evaluateProfileToolPolicy({
      toolName: 'read',
      candidateToolNames: ['read'],
      allowedTools: ['*'],
      deniedTools: ['read'],
      approvalRequiredTools: [],
    });

    expect(decision).toBe('deny');
  });

  it('requires approval when profile marks tool as approval-required', () => {
    const decision = service.evaluateProfileToolPolicy({
      toolName: 'create_tool_candidate',
      allowedTools: ['create_tool_candidate'],
      deniedTools: [],
      approvalRequiredTools: ['create_tool_candidate'],
    });

    expect(decision).toBe('approval_required');
  });

  it('returns runtime denied reason from snapshot denied entry', () => {
    const decision = service.decideRuntimeSnapshot({
      capabilityName: 'create_tool_candidate',
      callableTools: new Set(),
      approvalRequiredTools: new Set(),
      deniedTools: [
        {
          toolName: 'create_tool_candidate',
          reason: 'Blocked by policy',
          reasonCode: 'policy_denied',
        },
      ],
    });

    expect(decision).toEqual({
      status: 'denied',
      reason: 'Blocked by policy',
      deniedReasonCode: 'policy_denied',
    });
  });
});
