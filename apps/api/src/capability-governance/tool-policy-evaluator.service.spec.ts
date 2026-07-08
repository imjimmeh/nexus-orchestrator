import { Test, TestingModule } from '@nestjs/testing';
import { ToolPolicyEvaluatorService } from './tool-policy-evaluator.service';
import { ToolPolicyEffect, ToolPolicyDocument } from '@nexus/core';

describe('ToolPolicyEvaluatorService', () => {
  let service: ToolPolicyEvaluatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ToolPolicyEvaluatorService],
    }).compile();

    service = module.get<ToolPolicyEvaluatorService>(
      ToolPolicyEvaluatorService,
    );
  });

  it('should allow a tool matching an allow rule', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'ls' }],
    };
    const decision = await service.evaluate('ls', {}, policy);
    expect(decision.effect).toBe(ToolPolicyEffect.ALLOW);
  });

  it('should deny a tool matching a deny rule even if another rule allows it later', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.ALLOW,
      rules: [
        { effect: ToolPolicyEffect.DENY, tool: 'rm' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'rm' },
      ],
    };
    const decision = await service.evaluate('rm', {}, policy);
    expect(decision.effect).toBe(ToolPolicyEffect.DENY);
  });

  it('should require approval for matching rules', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [{ effect: ToolPolicyEffect.REQUIRE_APPROVAL, tool: 'git' }],
    };
    const decision = await service.evaluate(
      'git',
      { command: 'checkout' },
      policy,
    );
    expect(decision.effect).toBe(ToolPolicyEffect.REQUIRE_APPROVAL);
  });

  it('should use the default effect if no rules match', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [],
    };
    const decision = await service.evaluate('unknown', {}, policy);
    expect(decision.effect).toBe(ToolPolicyEffect.DENY);
  });

  it('should match tools with glob patterns', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        { effect: ToolPolicyEffect.ALLOW, tool: 'git*' },
        { effect: ToolPolicyEffect.ALLOW, tool: '*-service' },
      ],
    };

    expect((await service.evaluate('git-checkout', {}, policy)).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect((await service.evaluate('github-api', {}, policy)).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect((await service.evaluate('auth-service', {}, policy)).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect((await service.evaluate('svn', {}, policy)).effect).toBe(
      ToolPolicyEffect.DENY,
    );
  });

  it('should match multiple arguments', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'ls',
          arguments: { cmd: 'ls', path: '/tmp' },
        },
      ],
    };

    expect(
      (await service.evaluate('ls', { cmd: 'ls', path: '/tmp' }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (await service.evaluate('ls', { cmd: 'ls', path: '/etc' }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.DENY);
    expect(
      (await service.evaluate('ls', { cmd: 'dir', path: '/tmp' }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.DENY);
  });

  it('should match nested object arguments using deepEqual', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'docker',
          arguments: {
            config: { image: 'node', version: '20' },
          },
        },
      ],
    };

    expect(
      (
        await service.evaluate(
          'docker',
          { config: { image: 'node', version: '20' } },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (
        await service.evaluate(
          'docker',
          { config: { image: 'node', version: '18' } },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.DENY);
    expect(
      (
        await service.evaluate(
          'docker',
          { config: { image: 'ubuntu' } },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.DENY);
  });

  it('should match non-string arguments', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'calc',
          arguments: { count: 10, active: true },
        },
      ],
    };

    expect(
      (await service.evaluate('calc', { count: 10, active: true }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (await service.evaluate('calc', { count: 11, active: true }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.DENY);
    expect(
      (await service.evaluate('calc', { count: 10, active: false }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.DENY);
  });

  it('should match string arguments with glob patterns', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'read',
          arguments: { path: '/logs/*.log' },
        },
      ],
    };

    expect(
      (await service.evaluate('read', { path: '/logs/app.log' }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (await service.evaluate('read', { path: '/logs/error.log' }, policy))
        .effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (await service.evaluate('read', { path: '/etc/passwd' }, policy)).effect,
    ).toBe(ToolPolicyEffect.DENY);
  });

  it('should treat * as wildcard matching any arguments including absent keys', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: ['allow search_skills *', 'allow spawn_subagent_async *'],
    };

    expect(
      (
        await service.evaluate(
          'search_skills',
          { query: 'find skills' },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (
        await service.evaluate(
          'spawn_subagent_async',
          { subagent: 'code-review' },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect((await service.evaluate('search_skills', {}, policy)).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(
      (await service.evaluate('unknown_tool', { arg: 'val' }, policy)).effect,
    ).toBe(ToolPolicyEffect.DENY);
  });

  it('should match arguments that must be omitted', async () => {
    const policy: ToolPolicyDocument = {
      default: ToolPolicyEffect.DENY,
      rules: [
        {
          effect: ToolPolicyEffect.ALLOW,
          tool: 'invoke_agent_workflow',
          arguments: { workflow_id: { operator: 'absent' } },
        },
      ],
    };

    expect(
      (await service.evaluate('invoke_agent_workflow', {}, policy)).effect,
    ).toBe(ToolPolicyEffect.ALLOW);
    expect(
      (
        await service.evaluate(
          'invoke_agent_workflow',
          { workflow_id: 'standard_feature_flow' },
          policy,
        )
      ).effect,
    ).toBe(ToolPolicyEffect.DENY);
  });
});
