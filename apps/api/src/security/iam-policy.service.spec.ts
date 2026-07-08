import { ToolPolicyEffect } from '@nexus/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { IAMPolicyService } from './iam-policy.service';
import { ToolPolicyEvaluatorService } from '../capability-governance/tool-policy-evaluator.service';

describe('IAMPolicyService', () => {
  let service: IAMPolicyService;
  const findAllMock = vi.fn();

  const agentProfileRepository = {
    findAll: findAllMock,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    findAllMock.mockResolvedValue([
      {
        name: 'architect-agent',
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'check_subagent_status' },
            { effect: ToolPolicyEffect.DENY, tool: 'write' },
            { effect: ToolPolicyEffect.REQUIRE_APPROVAL, tool: 'bash' },
          ],
        },
        is_active: true,
      },
      {
        name: 'friendly-general-assistant',
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
          ],
        },
        is_active: true,
      },
      {
        name: 'staff_engineer',
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [{ effect: ToolPolicyEffect.ALLOW, tool: '*' }],
        },
        is_active: true,
      },
      {
        name: 'inactive-agent',
        tier_preference: 'light',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
        },
        is_active: false,
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IAMPolicyService,
        ToolPolicyEvaluatorService,
        {
          provide: AgentProfileRepository,
          useValue: agentProfileRepository,
        },
      ],
    }).compile();

    service = module.get<IAMPolicyService>(IAMPolicyService);
    await service.onApplicationBootstrap();
  });

  it('loads active profiles from the database on bootstrap', () => {
    expect(findAllMock).toHaveBeenCalledTimes(1);
    expect(service.getProfile('architect-agent')).toEqual(
      expect.objectContaining({
        name: 'architect-agent',
        toolPolicy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'check_subagent_status' },
            { effect: ToolPolicyEffect.DENY, tool: 'write' },
            { effect: ToolPolicyEffect.REQUIRE_APPROVAL, tool: 'bash' },
          ],
        },
      }),
    );
  });

  it('allows configured tools for active profiles', () => {
    expect(service.evaluateAccess('architect-agent', 'read')).toBe(true);
    expect(
      service.evaluateAccess('architect-agent', 'spawn_subagent_async'),
    ).toBe(true);
  });

  it('denies tools not present in allowed_tools', () => {
    expect(service.evaluateAccess('architect-agent', 'bash')).toBe(false);
    expect(
      service.evaluateAccess(
        'friendly-general-assistant',
        'wait_for_subagents',
      ),
    ).toBe(false);
  });

  it('denies inactive and unknown profiles', () => {
    expect(service.evaluateAccess('inactive-agent', 'read')).toBe(false);
    expect(service.evaluateAccess('unknown-agent', 'read')).toBe(false);
  });

  it('supports wildcard allowed_tools from the database', () => {
    expect(service.evaluateAccess('staff_engineer', 'git_push')).toBe(true);
    expect(service.evaluateAccess('staff_engineer', 'any_custom_tool')).toBe(
      true,
    );
  });

  it('refreshes cached policies from the database', async () => {
    findAllMock.mockResolvedValueOnce([
      {
        name: 'friendly-general-assistant',
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
          ],
        },
        is_active: true,
      },
    ]);

    await service.refreshPolicies();

    expect(
      service.evaluateAccess(
        'friendly-general-assistant',
        'spawn_subagent_async',
      ),
    ).toBe(false);
    expect(
      service.evaluateAccess(
        'friendly-general-assistant',
        'wait_for_subagents',
      ),
    ).toBe(true);
  });
});
