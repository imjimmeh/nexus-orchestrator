import { ToolPolicyEffect } from '@nexus/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import { ToolApprovalRuleRepository } from '../tool/database/repositories/tool-approval-rule.repository';
import type { ToolApprovalRule } from '../tool/database/entities/tool-approval-rule.entity';

type MockToolApprovalRuleRepository = {
  findActiveByToolName: ReturnType<typeof vi.fn>;
};

function createMockRepo(): MockToolApprovalRuleRepository {
  return {
    findActiveByToolName: vi.fn(),
  };
}

describe('ToolApprovalRuleService', () => {
  let repository: MockToolApprovalRuleRepository;
  let service: ToolApprovalRuleService;

  const investigationSubagentBashRules = [
    {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 300,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'regex',
          value:
            '(^|\\s)(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|git|npm|pnpm|yarn|docker|curl|wget|python|node|perl|ssh|ps|kill|tee)(\\s|$)|[>;`]|\\$\\(|\\|\\||&&|\\||\\bfind\\b.*\\s-(delete|exec|execdir|ok|okdir)\\b|\\bsed\\b.*(\\s-i\\b|(^|[\\s;])[0-9,$!{}\\s]*[we]\\b)',
        },
      ],
    },
    {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.ALLOW,
      priority: 200,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'regex',
          value: '^\\s*(ls|find|grep|rg|pwd|sed\\s+-n|head|tail|wc|cat)\\b',
        },
      ],
    },
    {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 100,
      argumentPatterns: null,
    },
  ] as ToolApprovalRule[];

  beforeEach(() => {
    repository = createMockRepo();
    service = new ToolApprovalRuleService(
      repository as unknown as ToolApprovalRuleRepository,
      { getAncestorIds: async () => [] } as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('matches agent-profile scoped deny rules against command payload', async () => {
    const rule = {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 100,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'regex',
          value: '(^|\\s)(rm|mv|cp|touch|mkdir|chmod|chown)(\\s|$)',
        },
      ],
    } as ToolApprovalRule;

    repository.findActiveByToolName.mockResolvedValueOnce([rule]);

    const effect = await service.resolveToolEffectExecution(
      { agentProfile: 'investigation-subagent' },
      'bash',
      { command: 'rm -rf /workspace' },
    );

    expect(effect).toBe('deny');
  });

  it('allows investigation subagent read-only bash discovery commands', async () => {
    repository.findActiveByToolName.mockResolvedValue(
      investigationSubagentBashRules,
    );

    await expect(
      service.resolveToolEffectExecution(
        { agentProfile: 'investigation-subagent' },
        'bash',
        { command: 'pwd' },
      ),
    ).resolves.toBe('allow');
    await expect(
      service.resolveToolEffectExecution(
        { agentProfile: 'investigation-subagent' },
        'bash',
        { command: 'ls packages/pi-runner/src' },
      ),
    ).resolves.toBe('allow');
  });

  it('denies unsafe investigation subagent bash command forms', async () => {
    repository.findActiveByToolName.mockResolvedValue(
      investigationSubagentBashRules,
    );

    for (const command of [
      'ls packages/pi-runner/src > files.txt',
      'rg "TODO" apps | head',
      'ls apps && npm test',
      'npm install',
      'python -c "print(1)"',
      'find . -delete',
      'mkdir -p docs/project-context/probe-results',
    ]) {
      await expect(
        service.resolveToolEffectExecution(
          { agentProfile: 'investigation-subagent' },
          'bash',
          { command },
        ),
      ).resolves.toBe('deny');
    }
  });

  it('does not match non-mutating command and returns null', async () => {
    const rule = {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 100,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'regex',
          value: '(^|\\s)(rm|mv|cp|touch|mkdir|chmod|chown)(\\s|$)',
        },
      ],
    } as ToolApprovalRule;

    repository.findActiveByToolName.mockResolvedValueOnce([rule]);

    const effect = await service.resolveToolEffectExecution(
      { agentProfile: 'investigation-subagent' },
      'bash',
      { command: 'rg "foo" apps/api/src' },
    );

    expect(effect).toBeNull();
  });

  it('matches glob patterns for payload.command', async () => {
    const rule = {
      scopeType: 'agent_profile',
      scopeId: 'investigation-subagent',
      toolName: 'bash',
      effect: ToolPolicyEffect.DENY,
      priority: 100,
      argumentPatterns: [
        {
          path: 'command',
          operator: 'glob',
          value: '*.sh',
        },
      ],
    } as ToolApprovalRule;

    repository.findActiveByToolName.mockResolvedValueOnce([rule]);

    const effect = await service.resolveToolEffectExecution(
      { agentProfile: 'investigation-subagent' },
      'bash',
      { command: 'ls script.sh' },
    );

    expect(effect).toBe('deny');
  });

  describe('findBestMatchingRule preflight with mixed argument/non-argument rules', () => {
    it('defers to execution when argument-pattern allow rules exist alongside no-pattern deny', async () => {
      const rules = [
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.DENY,
          priority: 300,
          argumentPatterns: null,
        },
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.ALLOW,
          priority: 200,
          argumentPatterns: [{ path: 'command', operator: 'eq', value: 'ls' }],
        },
      ] as ToolApprovalRule[];

      repository.findActiveByToolName.mockResolvedValueOnce(rules);

      const effect = await service.resolveToolEffectPreflight(
        { scopeId: 'test' },
        'bash',
      );

      expect(effect).toBeNull();
    });

    it('returns deny when only no-pattern deny rules exist (no argument rules)', async () => {
      const rules = [
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.DENY,
          priority: 300,
          argumentPatterns: null,
        },
      ] as ToolApprovalRule[];

      repository.findActiveByToolName.mockResolvedValueOnce(rules);

      const effect = await service.resolveToolEffectPreflight(
        { scopeId: 'test' },
        'bash',
      );

      expect(effect).toBe('deny');
    });

    it('returns allow when only no-pattern allow rules exist', async () => {
      const rules = [
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.ALLOW,
          priority: 300,
          argumentPatterns: null,
        },
      ] as ToolApprovalRule[];

      repository.findActiveByToolName.mockResolvedValueOnce(rules);

      const effect = await service.resolveToolEffectPreflight(
        { scopeId: 'test' },
        'bash',
      );

      expect(effect).toBe('allow');
    });

    it('still denies at execution when payload matches a deny argument pattern', async () => {
      const rules = [
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.DENY,
          priority: 300,
          argumentPatterns: null,
        },
        {
          scopeType: 'global',
          scopeId: null,
          toolName: 'bash',
          effect: ToolPolicyEffect.ALLOW,
          priority: 200,
          argumentPatterns: [{ path: 'command', operator: 'eq', value: 'ls' }],
        },
      ] as ToolApprovalRule[];

      repository.findActiveByToolName.mockResolvedValueOnce(rules);

      const effect = await service.resolveToolEffectExecution(
        { scopeId: 'test' },
        'bash',
        { command: 'rm -rf /' },
      );

      expect(effect).toBe('deny');
    });
  });
});
