import { describe, expect, it } from 'vitest';
import {
  resolveAllowedToolNamesForExecution,
  type CompanionToolRule,
} from './execution-tool-policy.helpers';

describe('resolveAllowedToolNamesForExecution', () => {
  describe('intersection', () => {
    it('excludes a tool that is in requestedTools but NOT in profileAllowed', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['read', 'write', 'bash'],
        profileAllowed: new Set(['read']),
      });

      expect(result).toContain('read');
      expect(result).not.toContain('write');
      expect(result).not.toContain('bash');
    });

    it('includes a tool that is in both requestedTools and profileAllowed', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['read', 'write'],
        profileAllowed: new Set(['read', 'write', 'bash']),
      });

      expect(result).toContain('read');
      expect(result).toContain('write');
    });
  });

  describe('deny-default', () => {
    it('returns empty array when requestedTools is empty', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: [],
        profileAllowed: new Set(['read', 'write']),
      });

      expect(result).toHaveLength(0);
    });

    it('returns empty array when profileAllowed is empty', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['read', 'write'],
        profileAllowed: new Set(),
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('companion tools', () => {
    const companionRules: CompanionToolRule[] = [
      {
        primaryTool: 'spawn_subagent_async',
        companionTool: 'wait_for_subagents',
      },
    ];

    it('includes companion when primary is granted by both requestedTools and profileAllowed', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['spawn_subagent_async', 'wait_for_subagents'],
        profileAllowed: new Set(['spawn_subagent_async', 'wait_for_subagents']),
        companionRules,
      });

      expect(result).toContain('spawn_subagent_async');
      expect(result).toContain('wait_for_subagents');
    });

    it('includes companion even if companion is NOT in profileAllowed when primary is granted', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['spawn_subagent_async', 'wait_for_subagents'],
        profileAllowed: new Set(['spawn_subagent_async']), // companion not in profile
        companionRules,
      });

      expect(result).toContain('spawn_subagent_async');
      expect(result).toContain('wait_for_subagents');
    });

    it('does NOT add companion when primary is denied by profileAllowed', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['spawn_subagent_async', 'wait_for_subagents'],
        profileAllowed: new Set(['wait_for_subagents']), // primary not in profile
        companionRules,
      });

      expect(result).not.toContain('spawn_subagent_async');
      expect(result).not.toContain('wait_for_subagents');
    });

    it('does NOT add companion when primary is denied by requestedTools', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['wait_for_subagents'], // primary not in requested
        profileAllowed: new Set(['spawn_subagent_async', 'wait_for_subagents']),
        companionRules,
      });

      expect(result).not.toContain('spawn_subagent_async');
      expect(result).not.toContain('wait_for_subagents');
    });

    it('does NOT add companion when companion is not in requestedTools', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['spawn_subagent_async'], // companion not requested
        profileAllowed: new Set(['spawn_subagent_async']),
        companionRules,
      });

      expect(result).toContain('spawn_subagent_async');
      expect(result).not.toContain('wait_for_subagents');
    });

    it('works without companionRules (no companion propagation)', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['spawn_subagent_async', 'wait_for_subagents'],
        profileAllowed: new Set(['spawn_subagent_async']),
        // no companionRules
      });

      expect(result).toContain('spawn_subagent_async');
      expect(result).not.toContain('wait_for_subagents');
    });
  });

  describe('result ordering', () => {
    it('returns an array (not a Set)', () => {
      const result = resolveAllowedToolNamesForExecution({
        requestedTools: ['read'],
        profileAllowed: new Set(['read']),
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
