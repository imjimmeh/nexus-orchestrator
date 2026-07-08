import { ToolPolicyEffect } from '@nexus/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import type { ToolApprovalRule } from '../tool/database/entities/tool-approval-rule.entity';

function rule(partial: Partial<ToolApprovalRule>): ToolApprovalRule {
  return {
    id: partial.id ?? 'r1',
    scopeType: partial.scopeType ?? 'global',
    scopeId: partial.scopeId ?? null,
    toolName: partial.toolName ?? 'fs.write',
    effect: partial.effect ?? 'deny',
    priority: partial.priority ?? 0,
    argumentPatterns: partial.argumentPatterns ?? null,
    createdBy: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ToolApprovalRuleService scope_node matching', () => {
  let ruleRepo: any;
  let scope: any;

  beforeEach(() => {
    scope = { getAncestorIds: vi.fn() };
  });

  it('matches a scope_node rule whose node is an ancestor of the execution scope', async () => {
    scope.getAncestorIds.mockResolvedValue(['root', 'org', 'proj']);
    ruleRepo = {
      findActiveByToolName: vi.fn().mockResolvedValue([
        rule({
          id: 'org-rule',
          scopeType: 'scope_node',
          scopeId: 'org',
          effect: ToolPolicyEffect.DENY,
        }),
      ]),
    };
    const svc = new ToolApprovalRuleService(ruleRepo, scope);
    const effect = await svc.resolveToolEffectPreflight(
      { scopeId: 'proj' },
      'fs.write',
    );
    expect(effect).toBe('deny');
    expect(scope.getAncestorIds).toHaveBeenCalledWith('proj');
  });

  it('does NOT match a scope_node rule on an unrelated node', async () => {
    scope.getAncestorIds.mockResolvedValue(['root', 'org', 'proj']);
    ruleRepo = {
      findActiveByToolName: vi.fn().mockResolvedValue([
        rule({
          id: 'other',
          scopeType: 'scope_node',
          scopeId: 'other-org',
          effect: ToolPolicyEffect.DENY,
        }),
      ]),
    };
    const svc = new ToolApprovalRuleService(ruleRepo, scope);
    expect(
      await svc.resolveToolEffectPreflight({ scopeId: 'proj' }, 'fs.write'),
    ).toBeNull();
  });

  it('prefers an exact project rule over an ancestor scope_node rule', async () => {
    scope.getAncestorIds.mockResolvedValue(['root', 'org', 'proj']);
    ruleRepo = {
      findActiveByToolName: vi.fn().mockResolvedValue([
        rule({
          id: 'org-rule',
          scopeType: 'scope_node',
          scopeId: 'org',
          effect: ToolPolicyEffect.REQUIRE_APPROVAL,
        }),
        rule({
          id: 'proj-rule',
          scopeType: 'project',
          scopeId: 'proj',
          effect: ToolPolicyEffect.ALLOW,
        }),
      ]),
    };
    const svc = new ToolApprovalRuleService(ruleRepo, scope);
    expect(
      await svc.resolveToolEffectPreflight({ scopeId: 'proj' }, 'fs.write'),
    ).toBe('allow');
  });

  it('keeps global behavior when no scope_node rules exist', async () => {
    ruleRepo = {
      findActiveByToolName: vi
        .fn()
        .mockResolvedValue([
          rule({ id: 'g', scopeType: 'global', effect: ToolPolicyEffect.DENY }),
        ]),
    };
    const svc = new ToolApprovalRuleService(ruleRepo, scope);
    expect(
      await svc.resolveToolEffectPreflight({ scopeId: 'proj' }, 'fs.write'),
    ).toBe('deny');
    // No ancestry lookup needed when no scope_node rules
    expect(scope.getAncestorIds).not.toHaveBeenCalled();
  });
});
