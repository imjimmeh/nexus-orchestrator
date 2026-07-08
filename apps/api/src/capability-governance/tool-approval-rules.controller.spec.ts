import { ToolPolicyEffect } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalRulesController } from './tool-approval-rules.controller';

describe('ToolApprovalRulesController', () => {
  const ruleService = {
    listRules: vi.fn(),
    getRuleOrThrow: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  };

  let controller: ToolApprovalRulesController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ToolApprovalRulesController(ruleService as never);
  });

  it('lists rules with filters', async () => {
    ruleService.listRules.mockResolvedValue([{ id: 'rule-1' }]);

    const result = await controller.listRules('project', 'project-1', 'bash');

    expect(result).toEqual([{ id: 'rule-1' }]);
    expect(ruleService.listRules).toHaveBeenCalledWith({
      scopeType: 'project',
      scopeId: 'project-1',
      toolName: 'bash',
      effect: undefined,
    });
  });

  it('creates a rule and converts expiresAt', async () => {
    ruleService.createRule.mockResolvedValue({ id: 'rule-1' });

    await controller.createRule({
      scopeType: 'project',
      scopeId: 'project-1',
      toolName: 'bash',
      effect: ToolPolicyEffect.ALLOW,
      expiresAt: new Date('2026-04-18T00:00:00.000Z'),
    });

    expect(ruleService.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'project',
        scopeId: 'project-1',
        toolName: 'bash',
        effect: ToolPolicyEffect.ALLOW,
        expiresAt: new Date('2026-04-18T00:00:00.000Z'),
      }),
    );
  });

  it('deletes a rule', async () => {
    ruleService.deleteRule.mockResolvedValue(undefined);

    const result = await controller.deleteRule('rule-1');

    expect(result).toEqual({ ok: true });
    expect(ruleService.deleteRule).toHaveBeenCalledWith('rule-1');
  });
});
