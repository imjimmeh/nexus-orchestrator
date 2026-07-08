import { ToolPolicyEffect } from '@nexus/core';
import { describe, it, expect, vi } from 'vitest';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import { ToolApprovalRuleRepository } from '../tool/database/repositories/tool-approval-rule.repository';
import { ToolApprovalRule } from '../tool/database/entities/tool-approval-rule.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function createMockRepo(rules: ToolApprovalRule[]): ToolApprovalRuleRepository {
  return {
    findActiveByToolName: vi.fn().mockResolvedValue(rules),
    findByFilters: vi.fn().mockResolvedValue(rules),
    findOne: vi.fn().mockImplementation(({ where }) => {
      const rule = rules.find((candidate) => candidate.id === where.id);
      return Promise.resolve(rule ?? null);
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation((r) => ({ ...r })),
    save: vi
      .fn()
      .mockImplementation((r) => Promise.resolve({ ...r, id: 'rule-1' })),
  } as unknown as ToolApprovalRuleRepository;
}

describe('ToolApprovalRuleService', () => {
  it('returns null when no rules match', async () => {
    const repo = createMockRepo([]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const result = await service.resolveToolEffectPreflight({}, 'bash');
    expect(result).toBeNull();
  });

  it('allows by exact tool name', async () => {
    const rule = new ToolApprovalRule();
    rule.scopeType = 'global';
    rule.scopeId = null;
    rule.toolName = 'bash';
    rule.effect = 'allow';
    rule.priority = 0;
    rule.argumentPatterns = null;
    const repo = createMockRepo([rule]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const result = await service.resolveToolEffectPreflight({}, 'bash');
    expect(result).toBe('allow');
  });

  it('matches glob pattern in execution', async () => {
    const rule = new ToolApprovalRule();
    rule.scopeType = 'project';
    rule.scopeId = 'proj-1';
    rule.toolName = 'bash';
    rule.effect = 'allow';
    rule.priority = 10;
    rule.argumentPatterns = [
      { path: 'command', operator: 'glob', value: '*.js' },
    ];
    const repo = createMockRepo([rule]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const result = await service.resolveToolEffectExecution(
      { scopeId: 'proj-1' },
      'bash',
      { command: 'ls *.js' },
    );
    expect(result).toBe('allow');
  });

  it('returns null for non-matching glob', async () => {
    const rule = new ToolApprovalRule();
    rule.scopeType = 'project';
    rule.scopeId = 'proj-1';
    rule.toolName = 'bash';
    rule.effect = 'allow';
    rule.priority = 10;
    rule.argumentPatterns = [
      { path: 'command', operator: 'glob', value: '*.py' },
    ];
    const repo = createMockRepo([rule]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const result = await service.resolveToolEffectExecution(
      { scopeId: 'proj-1' },
      'bash',
      { command: 'find . -name "*.js"' },
    );
    expect(result).toBeNull();
  });

  it('prefers more specific scope', async () => {
    const globalRule = new ToolApprovalRule();
    globalRule.scopeType = 'global';
    globalRule.scopeId = null;
    globalRule.toolName = 'bash';
    globalRule.effect = 'deny';
    globalRule.priority = 100;
    globalRule.argumentPatterns = null;

    const projectRule = new ToolApprovalRule();
    projectRule.scopeType = 'project';
    projectRule.scopeId = 'proj-1';
    projectRule.toolName = 'bash';
    projectRule.effect = 'allow';
    projectRule.priority = 0;
    projectRule.argumentPatterns = null;

    const repo = createMockRepo([globalRule, projectRule]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const result = await service.resolveToolEffectPreflight(
      { scopeId: 'proj-1' },
      'bash',
    );
    expect(result).toBe('allow');
  });

  it('creates rule from approval', async () => {
    const repo = createMockRepo([]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    const rule = await service.createRuleFromApproval({
      context: { scopeId: 'proj-1' },
      toolName: 'bash',
      argumentPatterns: [{ path: 'command', operator: 'eq', value: 'ls' }],
      effect: ToolPolicyEffect.ALLOW,
      createdBy: 'user:123',
      scopeType: 'project',
    });
    expect(rule.scopeType).toBe('project');
    expect(rule.scopeId).toBe('proj-1');
    expect(rule.effect).toBe('allow');
    expect(repo.save).toHaveBeenCalled();
  });

  it('lists rules via repository filters', async () => {
    const rule = new ToolApprovalRule();
    rule.id = 'rule-1';
    rule.scopeType = 'global';
    rule.scopeId = null;
    rule.toolName = 'bash';
    rule.effect = 'allow';
    rule.priority = 0;
    rule.argumentPatterns = null;
    const repo = createMockRepo([rule]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);

    const result = await service.listRules({ scopeType: 'global' });
    expect(result).toHaveLength(1);
    expect(repo.findByFilters).toHaveBeenCalledWith({ scopeType: 'global' });
  });

  it('throws when creating non-global rule without scope id', async () => {
    const repo = createMockRepo([]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);

    await expect(
      service.createRule({
        scopeType: 'project',
        toolName: 'bash',
        effect: ToolPolicyEffect.ALLOW,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws on invalid regex pattern', async () => {
    const repo = createMockRepo([]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);

    await expect(
      service.createRule({
        scopeType: 'global',
        toolName: 'bash',
        effect: ToolPolicyEffect.ALLOW,
        argumentPatterns: [{ path: 'command', operator: 'regex', value: '[' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates existing rule', async () => {
    const existing = new ToolApprovalRule();
    existing.id = 'rule-1';
    existing.scopeType = 'global';
    existing.scopeId = null;
    existing.toolName = 'bash';
    existing.effect = 'allow';
    existing.priority = 0;
    existing.argumentPatterns = null;
    existing.createdBy = null;
    existing.expiresAt = null;
    existing.createdAt = new Date();
    existing.updatedAt = new Date();

    const repo = createMockRepo([existing]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    await service.updateRule('rule-1', {
      effect: ToolPolicyEffect.DENY,
      priority: 5,
    });

    expect(repo.save).toHaveBeenCalled();
  });

  it('throws when updating unknown rule', async () => {
    const repo = createMockRepo([]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);

    await expect(
      service.updateRule('missing', { effect: ToolPolicyEffect.DENY }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes existing rule', async () => {
    const existing = new ToolApprovalRule();
    existing.id = 'rule-1';
    existing.scopeType = 'global';
    existing.scopeId = null;
    existing.toolName = 'bash';
    existing.effect = 'allow';
    existing.priority = 0;
    existing.argumentPatterns = null;
    existing.createdBy = null;
    existing.expiresAt = null;
    existing.createdAt = new Date();
    existing.updatedAt = new Date();

    const repo = createMockRepo([existing]);
    const service = new ToolApprovalRuleService(repo, {
      getAncestorIds: async () => [],
    } as any);
    await service.deleteRule('rule-1');

    expect(repo.remove).toHaveBeenCalledWith(existing);
  });
});
