import { ToolPolicyEffect } from '@nexus/core';
import { describe, expect, it } from 'vitest';
import {
  computeEffectiveCallableTools,
  type AgentToolPolicy,
} from './seed-data-validation.effective-access.helpers';

describe('Seed Validation Improvements', () => {
  describe('computeEffectiveCallableTools', () => {
    const allTools = new Set([
      'read',
      'write',
      'bash',
      'invoke_agent_workflow',
      'query_memory',
      'set_job_output',
      'update_external',
    ]);

    // set_job_output and yield_session are implicitly callable orchestration
    // primitives, added unless a job policy explicitly denies them.
    const withImplicitPrimitives = (tools: Iterable<string>): Set<string> =>
      new Set([...tools, 'set_job_output', 'yield_session']);

    it('all tools callable when no policies specified', () => {
      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
      });

      expect(result).toEqual(withImplicitPrimitives(allTools));
    });

    it('respects agent allowed_tools whitelist', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      expect(result).toEqual(withImplicitPrimitives(['read', 'write', 'bash']));
    });

    it('respects agent denied_tools blacklist', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [
            { effect: ToolPolicyEffect.DENY, tool: 'invoke_agent_workflow' },
            { effect: ToolPolicyEffect.DENY, tool: 'update_external' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      const expected = new Set(allTools);
      expected.delete('invoke_agent_workflow');
      expected.delete('update_external');

      expect(result).toEqual(withImplicitPrimitives(expected));
    });

    it('wildcard in allowed_tools means all tools', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      expect(result).toEqual(withImplicitPrimitives(allTools));
    });

    it('denies tools both allowed and denied (denied wins)', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'invoke_agent_workflow' },
            { effect: ToolPolicyEffect.DENY, tool: 'invoke_agent_workflow' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      expect(result).toEqual(withImplicitPrimitives(['read', 'write', 'bash']));
    });

    it('workflow policy narrows agent allowed set', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [],
        },
      };

      const workflowPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
        workflowPermissions,
      });

      expect(result).toEqual(
        withImplicitPrimitives(['read', 'write', 'query_memory']),
      );
    });

    it('job policy further narrows workflow policy', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [],
        },
      };

      const workflowPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
      };

      const jobPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
        workflowPermissions,
        jobPermissions,
      });

      expect(result).toEqual(withImplicitPrimitives(['read', 'query_memory']));
    });

    it('job deny_tools removes specific tools from allowed set', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [],
        },
      };

      const jobPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [
            { effect: ToolPolicyEffect.DENY, tool: 'invoke_agent_workflow' },
            { effect: ToolPolicyEffect.DENY, tool: 'update_external' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
        jobPermissions,
      });

      const expected = new Set(allTools);
      expected.delete('invoke_agent_workflow');
      expected.delete('update_external');

      expect(result).toEqual(withImplicitPrimitives(expected));
    });

    it('profile_only strategy ignores workflow/job permissions', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
          ],
        },
      };

      const workflowPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'invoke_agent_workflow' },
          ],
        },
      };

      const jobPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
        workflowPermissions,
        jobPermissions,
        policyStrategy: 'profile_only',
      });

      // Should only respect agent policy, ignore workflow/job
      expect(result).toEqual(withImplicitPrimitives(['read', 'write']));
    });

    it('set_job_output always added unless explicitly denied', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      expect(result.has('set_job_output')).toBe(true);
    });

    it('respects only known tools from agent list', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'nonexistent_tool' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
          ],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
      });

      // nonexistent_tool should be ignored
      expect(result).toEqual(withImplicitPrimitives(['read', 'write', 'bash']));
    });

    it('combines multiple narrowing layers correctly', () => {
      const agentPolicy: AgentToolPolicy = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [{ effect: ToolPolicyEffect.DENY, tool: 'update_external' }],
        },
      };

      const workflowPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'invoke_agent_workflow' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
      };

      const jobPermissions = {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [{ effect: ToolPolicyEffect.DENY, tool: 'bash' }],
        },
      };

      const result = computeEffectiveCallableTools({
        allKnownTools: allTools,
        agentPolicy,
        workflowPermissions,
        jobPermissions,
      });

      // Start with all except update_external (agent denied)
      // Narrow to workflow allow list
      // Remove bash (job denied)
      expect(result).toEqual(
        withImplicitPrimitives([
          'read',
          'write',
          'invoke_agent_workflow',
          'query_memory',
        ]),
      );
    });
  });
});
