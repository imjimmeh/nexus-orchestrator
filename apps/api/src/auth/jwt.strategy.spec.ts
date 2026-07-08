import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy';

type MockConfigService = {
  get: ReturnType<typeof vi.fn>;
};

type MockUserRepository = {
  findById: ReturnType<typeof vi.fn>;
  findByUsername: ReturnType<typeof vi.fn>;
};

describe('JwtStrategy', () => {
  function createMocks(env = 'development'): {
    config: MockConfigService;
    users: MockUserRepository;
  } {
    const config: MockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        if (key === 'NODE_ENV') return env;
        return undefined;
      }),
    };

    const users: MockUserRepository = {
      findById: vi.fn(),
      findByUsername: vi.fn(),
    };

    return { config, users };
  }

  it('normalizes roles to an empty array for existing user when payload roles are missing', async () => {
    const { config, users } = createMocks();
    users.findById.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@nexus.local',
      isActive: true,
    });

    const strategy = new JwtStrategy(config, users as never);
    const result = await strategy.validate({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'user@nexus.local',
      roles: undefined as unknown as string[],
    });

    expect(result).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'user@nexus.local',
      roles: [],
    });
  });

  it('accepts agent payload and preserves normalized roles', async () => {
    const { config, users } = createMocks();
    const strategy = new JwtStrategy(config, users as never);

    const result = await strategy.validate({
      sub: 'agent:run-1:job-1',
      email: 'agent@nexus.local',
      roles: ['Agent', ''],
      role: 'agent',
      agentProfileName: 'investigation-subagent',
      workflowRunId: 'run-1',
      stepId: 'subagent-execution-1',
      jobId: 'implement',
      scopeId: 'scope-1',
      isSubagent: true,
      subagentExecutionId: 'subagent-execution-1',
      parent_job_id: 'run_scope_probes',
      allowedTools: ['bash', '', 123],
    });

    expect(result).toEqual({
      userId: 'agent:run-1:job-1',
      email: 'agent@nexus.local',
      roles: ['Agent'],
      agentProfileName: 'investigation-subagent',
      workflowRunId: 'run-1',
      stepId: 'subagent-execution-1',
      jobId: 'implement',
      scopeId: 'scope-1',
      isSubagent: true,
      subagentExecutionId: 'subagent-execution-1',
      parentJobId: 'run_scope_probes',
      allowedTools: ['bash'],
    });
    expect(users.findById).not.toHaveBeenCalled();
    expect(users.findByUsername).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when user is missing in production fallback path', async () => {
    const { config, users } = createMocks('production');
    users.findByUsername.mockResolvedValue(null);

    const strategy = new JwtStrategy(config, users as never);

    await expect(
      strategy.validate({
        sub: 'missing-user',
        email: 'missing@nexus.local',
        roles: ['Admin'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
