import { describe, expect, it } from 'vitest';
import type { IJob, IToolPermissionPolicy } from '@nexus/core';
import { ToolPolicyEffect } from '@nexus/core';
import { resolveAllowedToolNamesForStep } from './step-support-tool-policy.helpers';
import { normalizeToolPolicy } from './step-support.helpers';

describe('resolveAllowedToolNamesForStep', () => {
  const applyPolicyToToolNames = (
    baseToolNames: Set<string>,
    _candidateToolNames: Set<string>,
    policy: unknown,
  ): Set<string> => {
    const { allow, deny } = normalizeToolPolicy(policy);
    const resolved = allow.has('*')
      ? new Set(baseToolNames)
      : allow.size > 0
        ? new Set([...baseToolNames].filter((name) => allow.has(name)))
        : new Set(baseToolNames);
    for (const denied of deny) {
      resolved.delete(denied);
    }
    return resolved;
  };

  const baseJob = {
    id: 'job',
    type: 'execution',
    steps: [],
    output_contract: {
      required: ['decision'],
    },
  } as unknown as IJob;

  it('keeps set_job_output callable when output_contract requires it even if not listed in job tools', async () => {
    const allowed = await resolveAllowedToolNamesForStep({
      tools: [{ name: 'read' }],
      job: {
        ...baseJob,
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              {
                effect: ToolPolicyEffect.ALLOW,
                tool: 'external.write_probe_result',
              },
              { effect: ToolPolicyEffect.ALLOW, tool: 'external.scope_state' },
            ],
          },
        },
      },
      agentProfile: 'ceo-agent',
      canProfileUseTool: (profile, tool) => tool === 'read',
      applyPolicyToToolNames,
    });

    expect(allowed.has('set_job_output')).toBe(true);
  });

  it('does not keep set_job_output when explicitly denied by job policy', async () => {
    const allowed = await resolveAllowedToolNamesForStep({
      tools: [{ name: 'read' }, { name: 'set_job_output' }],
      job: {
        ...baseJob,
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [{ effect: ToolPolicyEffect.DENY, tool: 'set_job_output' }],
          },
        },
      },
      agentProfile: 'ceo-agent',
      canProfileUseTool: (profile, tool) => tool === 'read',
      applyPolicyToToolNames,
    });

    expect(allowed.has('set_job_output')).toBe(false);
  });

  it('preserves external.write_probe_result when both job policy and agent profile allow it', async () => {
    const allowedTools = [
      'read',
      'ls',
      'bash',
      'write',
      'edit',
      'spawn_subagent_async',
      'wait_for_subagents',
      'set_job_output',
      'step_complete',
      'ask_user_questions',
      'external.scope_state',
      'external.write_probe_result',
      'external.orchestration_timeline',
      'get_todo_list',
      'manage_todo_list',
    ];
    const allowed = await resolveAllowedToolNamesForStep({
      tools: [
        { name: 'external.write_probe_result' },
        { name: 'external.scope_state' },
        { name: 'read' },
        { name: 'write' },
        { name: 'set_job_output' },
      ],
      job: {
        ...baseJob,
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              {
                effect: ToolPolicyEffect.ALLOW,
                tool: 'external.write_probe_result',
              },
              { effect: ToolPolicyEffect.ALLOW, tool: 'external.scope_state' },
            ],
          },
        },
      },
      agentProfile: 'investigation-coordinator',
      canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
      applyPolicyToToolNames,
    });

    expect(allowed.has('external.scope_state')).toBe(true);
    expect(allowed.has('external.write_probe_result')).toBe(true);
  });

  it('preserves CEO cycle decision persistence when workflow and profile both allow it', async () => {
    const allowedTools = [
      'external.scope_state',
      'external.orchestration_timeline',
      'external.orchestration_record_cycle_decision',
      'external.orchestration_complete',
      'set_job_output',
    ];
    const allowed = await resolveAllowedToolNamesForStep({
      tools: [
        { name: 'external.scope_state' },
        { name: 'external.orchestration_timeline' },
        { name: 'external.orchestration_record_cycle_decision' },
        { name: 'external.orchestration_complete' },
        { name: 'set_job_output' },
      ],
      job: baseJob,
      workflowPermissions: {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'external.scope_state' },
            {
              effect: ToolPolicyEffect.ALLOW,
              tool: 'external.orchestration_timeline',
            },
            {
              effect: ToolPolicyEffect.ALLOW,
              tool: 'external.orchestration_record_cycle_decision',
            },
            {
              effect: ToolPolicyEffect.ALLOW,
              tool: 'external.orchestration_complete',
            },
            { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
          ],
        },
      },
      agentProfile: 'ceo-agent',
      canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
      applyPolicyToToolNames,
    });

    expect(allowed.has('external.orchestration_record_cycle_decision')).toBe(
      true,
    );
  });

  describe('companion tool logic', () => {
    const toolsWithSubagent = [
      { name: 'read' },
      { name: 'write' },
      { name: 'spawn_subagent_async' },
      { name: 'wait_for_subagents' },
    ];

    it('includes wait_for_subagents when spawn_subagent_async is allowed by profile', async () => {
      const allowedTools = ['read', 'write', 'spawn_subagent_async'];
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: baseJob,
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      expect(allowed.has('spawn_subagent_async')).toBe(true);
      expect(allowed.has('wait_for_subagents')).toBe(true);
    });

    it('does NOT include wait_for_subagents if spawn_subagent_async is denied', async () => {
      const allowedTools = ['read', 'write', 'wait_for_subagents']; // spawn_subagent_async is denied/omitted
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: baseJob,
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      expect(allowed.has('spawn_subagent_async')).toBe(false);
      expect(allowed.has('wait_for_subagents')).toBe(false);
    });

    it('respects explicit denial of wait_for_subagents at job level', async () => {
      const allowedTools = [
        'read',
        'write',
        'spawn_subagent_async',
        'wait_for_subagents',
      ];
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: {
          ...baseJob,
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.ALLOW,
              rules: [
                { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
              ],
            },
          },
        },
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      expect(allowed.has('spawn_subagent_async')).toBe(true);
      expect(allowed.has('wait_for_subagents')).toBe(false);
    });

    it('does NOT include wait_for_subagents if spawn_subagent_async is denied at workflow level', async () => {
      const allowedTools = [
        'read',
        'write',
        'spawn_subagent_async',
        'wait_for_subagents',
      ];
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: {
          ...baseJob,
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'spawn_subagent_async',
                },
                { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
              ],
            },
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'spawn_subagent_async' },
            ],
          },
        },
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      expect(allowed.has('spawn_subagent_async')).toBe(false);
      expect(allowed.has('wait_for_subagents')).toBe(false);
    });

    it('includes wait_for_subagents when spawn_subagent_async allowed by workflow/job but not by profile', async () => {
      const allowedTools = ['read', 'write', 'spawn_subagent_async'];
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: {
          ...baseJob,
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [
                { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
                { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'spawn_subagent_async',
                },
              ],
            },
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
            ],
          },
        },
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      // spawn_subagent_async should be allowed
      expect(allowed.has('spawn_subagent_async')).toBe(true);
      // wait_for_subagents should ALSO be allowed as a companion tool
      // even though it wasn't explicitly in the profile
      expect(allowed.has('wait_for_subagents')).toBe(true);
    });

    it('includes wait_for_subagents in profile_only mode when spawn_subagent_async allowed by workflow but not by profile', async () => {
      const allowedTools = ['read', 'write', 'spawn_subagent_async'];
      const allowed = await resolveAllowedToolNamesForStep({
        tools: toolsWithSubagent,
        job: {
          ...baseJob,
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [
                { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
                { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'spawn_subagent_async',
                },
              ],
            },
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
            ],
          },
          policy_strategy: 'profile_only',
        },
        policyStrategy: 'profile_only',
        agentProfile: 'subagent-manager',
        canProfileUseTool: (profile, tool) => allowedTools.includes(tool),
        applyPolicyToToolNames,
      });

      expect(allowed.has('spawn_subagent_async')).toBe(true);
      expect(allowed.has('wait_for_subagents')).toBe(true);
    });
  });
});
