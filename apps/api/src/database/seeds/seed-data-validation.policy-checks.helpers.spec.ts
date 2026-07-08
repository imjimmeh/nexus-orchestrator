import { describe, expect, it } from 'vitest';
import { ToolPolicyEffect, type IJob } from '@nexus/core';
import type {
  AgentToolPolicy,
  SeedValidationIssue,
} from './seed-data-validation.types';
import { validateJobToolsAgainstProfile } from './seed-data-validation.policy-checks.helpers';

function makeJob(overrides: Partial<IJob> = {}): IJob {
  return {
    id: 'test_job',
    type: 'execution',
    tier: 'heavy',
    inputs: { agent_profile: 'architect-agent' },
    permissions: {
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'open_war_room' },
        ],
      },
    },
    ...overrides,
  };
}

function makeAgentPolicy(tools: string[]): AgentToolPolicy {
  return {
    tool_policy: {
      default: ToolPolicyEffect.DENY,
      rules: tools.map((tool) => `allow ${tool} *`),
    },
  };
}

describe('validateJobToolsAgainstProfile', () => {
  it('flags tools allowed by job permissions but missing from the agent profile', () => {
    const errors: SeedValidationIssue[] = [];
    const allKnownTools = new Set([
      'read',
      'write',
      'open_war_room',
      'post_war_room_message',
    ]);

    validateJobToolsAgainstProfile({
      job: makeJob(),
      agentName: 'architect-agent',
      agentPolicy: makeAgentPolicy(['read', 'write']),
      allKnownTools,
      filePath: 'seed/workflows/test.workflow.yaml',
      workflowId: 'test_workflow',
      errors,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('job-tool-not-in-profile');
    expect(errors[0]?.message).toContain('open_war_room');
    expect(errors[0]?.message).toContain('architect-agent');
  });

  it('passes when all job-allowed tools are also allowed by the agent profile', () => {
    const errors: SeedValidationIssue[] = [];
    const allKnownTools = new Set(['read', 'write', 'open_war_room']);

    validateJobToolsAgainstProfile({
      job: makeJob(),
      agentName: 'architect-agent',
      agentPolicy: makeAgentPolicy(['read', 'write', 'open_war_room']),
      allKnownTools,
      filePath: 'seed/workflows/test.workflow.yaml',
      workflowId: 'test_workflow',
      errors,
    });

    expect(errors).toHaveLength(0);
  });

  it('skips validation when no agent policy is provided', () => {
    const errors: SeedValidationIssue[] = [];
    const allKnownTools = new Set(['read', 'open_war_room']);

    validateJobToolsAgainstProfile({
      job: makeJob(),
      agentName: undefined,
      agentPolicy: undefined,
      allKnownTools,
      filePath: 'seed/workflows/test.workflow.yaml',
      workflowId: 'test_workflow',
      errors,
    });

    expect(errors).toHaveLength(0);
  });

  it('skips tools that are not in the known tool set', () => {
    const errors: SeedValidationIssue[] = [];
    const allKnownTools = new Set(['read']);

    validateJobToolsAgainstProfile({
      job: makeJob({
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'unknown_tool' },
            ],
          },
        },
      }),
      agentName: 'architect-agent',
      agentPolicy: makeAgentPolicy(['read']),
      allKnownTools,
      filePath: 'seed/workflows/test.workflow.yaml',
      workflowId: 'test_workflow',
      errors,
    });

    expect(errors).toHaveLength(0);
  });

  it('handles string-format tool policy rules in job permissions', () => {
    const errors: SeedValidationIssue[] = [];
    const allKnownTools = new Set(['read', 'open_war_room']);

    validateJobToolsAgainstProfile({
      job: makeJob({
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: ['allow read *', 'allow open_war_room *'],
          },
        },
      }),
      agentName: 'architect-agent',
      agentPolicy: makeAgentPolicy(['read']),
      allKnownTools,
      filePath: 'seed/workflows/test.workflow.yaml',
      workflowId: 'test_workflow',
      errors,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('open_war_room');
  });
});
