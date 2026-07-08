import { describe, expect, it } from 'vitest';
import { ToolPolicyEffect } from '@nexus/core';
import {
  COMPANION_TOOLS,
  applyCompanionToolLogic,
  isCompanionToolAllowed,
  getCompanionToolsToAdd,
} from './companion-tool.helpers';

describe('COMPANION_TOOLS constant', () => {
  it('maps spawn_subagent_async to wait_for_subagents', () => {
    expect(COMPANION_TOOLS['spawn_subagent_async']).toBe('wait_for_subagents');
  });

  it('contains expected companion relationships', () => {
    expect(Object.keys(COMPANION_TOOLS).length).toBeGreaterThan(0);
    expect(Object.values(COMPANION_TOOLS)).toContain('wait_for_subagents');
  });
});

describe('applyCompanionToolLogic', () => {
  describe('when primary tool is allowed', () => {
    it('adds companion tool to allowed set when spawn_subagent_async is allowed', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('adds companion tool even when not explicitly in available tools but listed in allowedTools', () => {
      const allowedTools = new Set<string>([
        'spawn_subagent_async',
        'wait_for_subagents',
      ]);
      const availableTools = ['spawn_subagent_async'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      // wait_for_subagents is already in allowedTools, so it stays
      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });
  });

  describe('when primary tool is NOT allowed', () => {
    it('does NOT add companion tool when spawn_subagent_async is not in allowed tools', () => {
      const allowedTools = new Set<string>(['read', 'write']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      expect(allowedTools.has('spawn_subagent_async')).toBe(false);
      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });

    it('does NOT add companion tool when allowed set is empty', () => {
      const allowedTools = new Set<string>();
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });
  });

  describe('respects workflow-level denials', () => {
    it('does NOT add companion tool when deny list includes wait_for_subagents at workflow level', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });

    it('still adds companion tool when deny list only includes other tools at workflow level', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'read' },
              { effect: ToolPolicyEffect.DENY, tool: 'write' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('respects workflow deny with empty allow list', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });
  });

  describe('respects job-level denials', () => {
    it('does NOT add companion tool when deny list includes wait_for_subagents at job level', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });

    it('still adds companion tool when job-level deny list does not include companion tool', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'bash' },
              { effect: ToolPolicyEffect.DENY, tool: 'read' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('respects workflow deny even when job permissions are undefined', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });
  });

  describe('respects both workflow and job denials together', () => {
    it('does NOT add companion tool when denied at workflow level even if job allows it', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
            ],
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });

    it('does NOT add companion tool when denied at job level even if workflow allows it', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [
              { effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' },
            ],
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty availableTools array', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);

      applyCompanionToolLogic({
        allowedTools,
        availableTools: [],
      });

      // No crash, companion tool not added because companion is not available
      expect(allowedTools.has('wait_for_subagents')).toBe(false);
    });

    it('handles undefined jobPermissions', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: undefined,
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('handles undefined workflowPermissions', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        workflowPermissions: undefined,
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('handles empty deny_tools array', () => {
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
        jobPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [],
          },
        },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.ALLOW,
            rules: [],
          },
        },
      });

      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('does not add companion tool twice if already present', () => {
      const allowedTools = new Set<string>([
        'spawn_subagent_async',
        'wait_for_subagents',
      ]);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      // Should not throw, and companion tool remains
      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });
  });

  describe('multiple companion tool scenarios', () => {
    it('handles multiple primary tools with companion tools', () => {
      // Test that we can handle multiple primary tools
      const allowedTools = new Set<string>(['spawn_subagent_async']);
      const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      expect(allowedTools.has('spawn_subagent_async')).toBe(true);
      expect(allowedTools.has('wait_for_subagents')).toBe(true);
    });

    it('only adds companions for primary tools that are actually allowed', () => {
      const allowedTools = new Set<string>(['read', 'write']);
      const availableTools = [
        'spawn_subagent_async',
        'wait_for_subagents',
        'read',
        'write',
      ];

      applyCompanionToolLogic({
        allowedTools,
        availableTools,
      });

      expect(allowedTools.has('spawn_subagent_async')).toBe(false);
      expect(allowedTools.has('wait_for_subagents')).toBe(false);
      expect(allowedTools.has('read')).toBe(true);
      expect(allowedTools.has('write')).toBe(true);
    });
  });
});

describe('isCompanionToolAllowed', () => {
  describe('valid companion tool relationships', () => {
    it('returns true when primary is allowed and companion is not denied', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['spawn_subagent_async']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(true);
    });

    it('returns true when companion tool already in allowedTools', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['spawn_subagent_async', 'wait_for_subagents']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(true);
    });
  });

  describe('invalid companion tool relationships', () => {
    it('returns false when companion tool does not match the expected companion for primary', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'read', // Not the companion for spawn_subagent_async
        allowedTools: new Set(['spawn_subagent_async']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(false);
    });

    it('returns false when primary tool is not allowed', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['read', 'write']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(false);
    });

    it('returns false when companion tool is denied at job level', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['spawn_subagent_async']),
        jobDeny: new Set(['wait_for_subagents']),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(false);
    });

    it('returns false when companion tool is denied at workflow level', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['spawn_subagent_async']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set(['wait_for_subagents']),
      });

      expect(result).toBe(false);
    });

    it('returns false when companion tool is denied at both levels', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['spawn_subagent_async']),
        jobDeny: new Set(['wait_for_subagents']),
        workflowDeny: new Set(['wait_for_subagents']),
      });

      expect(result).toBe(false);
    });
  });

  describe('unknown primary tool', () => {
    it('returns false for unknown primary tool', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'unknown_tool',
        companionTool: 'some_companion',
        allowedTools: new Set(['unknown_tool']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(false);
    });

    it('returns false when primary tool not in COMPANION_TOOLS mapping', () => {
      const result = isCompanionToolAllowed({
        primaryTool: 'bash',
        companionTool: 'wait_for_subagents',
        allowedTools: new Set(['bash']),
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toBe(false);
    });
  });
});

describe('getCompanionToolsToAdd', () => {
  describe('basic functionality', () => {
    it('returns list of companion tools to add when primary is allowed', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toContain('wait_for_subagents');
    });

    it('returns empty array when no companion tools need to be added', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['read', 'write']),
        availableTools: [
          'spawn_subagent_async',
          'wait_for_subagents',
          'read',
          'write',
        ],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).not.toContain('wait_for_subagents');
      expect(result).toHaveLength(0);
    });

    it('returns empty array when companion tool already in allowedTools', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async', 'wait_for_subagents']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).not.toContain('wait_for_subagents');
      expect(result).toHaveLength(0);
    });
  });

  describe('denial handling', () => {
    it('does not include companion tool denied at workflow level', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set(['wait_for_subagents']),
      });

      expect(result).not.toContain('wait_for_subagents');
    });

    it('does not include companion tool denied at job level', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set(['wait_for_subagents']),
        workflowDeny: new Set<string>(),
      });

      expect(result).not.toContain('wait_for_subagents');
    });

    it('does not include companion tool denied at either level', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set(['wait_for_subagents']),
        workflowDeny: new Set(['wait_for_subagents']),
      });

      expect(result).not.toContain('wait_for_subagents');
    });
  });

  describe('primary tool not allowed scenarios', () => {
    it('returns empty array when primary tool not in allowedTools', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['read', 'write']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toHaveLength(0);
    });

    it('returns empty array when allowedTools is empty', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set<string>(),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty availableTools', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: [],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).not.toContain('wait_for_subagents');
    });

    it('handles companion tool not in availableTools', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async'], // wait_for_subagents not available
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).not.toContain('wait_for_subagents');
    });

    it('handles empty deny sets', () => {
      const result = getCompanionToolsToAdd({
        allowedTools: new Set(['spawn_subagent_async']),
        availableTools: ['spawn_subagent_async', 'wait_for_subagents'],
        jobDeny: new Set<string>(),
        workflowDeny: new Set<string>(),
      });

      expect(result).toContain('wait_for_subagents');
    });
  });
});

describe('integration: companion tool logic in workflow/job policy scenarios', () => {
  it('companion tool is added when primary is allowed by workflow/job policy', () => {
    // Simulate a scenario where workflow allows spawn_subagent_async
    // but profile doesn't explicitly list wait_for_subagents
    const allowedTools = new Set<string>(['spawn_subagent_async']);
    const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];
    const workflowPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
        ],
      },
    };

    applyCompanionToolLogic({
      allowedTools,
      availableTools,
      workflowPermissions,
    });

    // wait_for_subagents should be added as a companion tool
    expect(allowedTools.has('wait_for_subagents')).toBe(true);
  });

  it('companion tool is NOT added when companion is denied at workflow level even if primary is allowed', () => {
    const allowedTools = new Set<string>(['spawn_subagent_async']);
    const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];
    const workflowPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.ALLOW,
        rules: [{ effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' }],
      },
    };

    applyCompanionToolLogic({
      allowedTools,
      availableTools,
      workflowPermissions,
    });

    // Companion tool denial at workflow level should be respected
    expect(allowedTools.has('wait_for_subagents')).toBe(false);
  });

  it('companion tool is NOT added when companion is denied at job level even if primary is allowed', () => {
    const allowedTools = new Set<string>(['spawn_subagent_async']);
    const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];
    const jobPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.ALLOW,
        rules: [{ effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' }],
      },
    };

    applyCompanionToolLogic({
      allowedTools,
      availableTools,
      jobPermissions,
    });

    // Companion tool denial at job level should be respected
    expect(allowedTools.has('wait_for_subagents')).toBe(false);
  });

  it('companion tool respects workflow-level denial even when job allows it', () => {
    const allowedTools = new Set<string>(['spawn_subagent_async']);
    const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];
    const workflowPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.ALLOW,
        rules: [{ effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' }],
      },
    };
    const jobPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
        ],
      },
    };

    applyCompanionToolLogic({
      allowedTools,
      availableTools,
      jobPermissions,
      workflowPermissions,
    });

    // Workflow level denial should take precedence
    expect(allowedTools.has('wait_for_subagents')).toBe(false);
  });

  it('companion tool respects job-level denial even when workflow allows it', () => {
    const allowedTools = new Set<string>(['spawn_subagent_async']);
    const availableTools = ['spawn_subagent_async', 'wait_for_subagents'];
    const workflowPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
          { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
        ],
      },
    };
    const jobPermissions = {
      tool_policy: {
        default: ToolPolicyEffect.ALLOW,
        rules: [{ effect: ToolPolicyEffect.DENY, tool: 'wait_for_subagents' }],
      },
    };

    applyCompanionToolLogic({
      allowedTools,
      availableTools,
      jobPermissions,
      workflowPermissions,
    });

    // Job level denial should take precedence
    expect(allowedTools.has('wait_for_subagents')).toBe(false);
  });
});
