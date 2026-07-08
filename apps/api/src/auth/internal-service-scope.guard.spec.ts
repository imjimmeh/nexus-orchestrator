import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { InternalServiceScopes } from './internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from './internal-service-scope.guard';

class GuardScopeTestController {
  @InternalServiceScopes('core.workflow-runs:write')
  writeHandler(): void {}
}

describe('InternalServiceScopeGuard', () => {
  it('allows service token that carries required scopes', () => {
    const guard = new InternalServiceScopeGuard(
      new Reflector(),
      new ConfigService({ JWT_SECRET: 'scope-secret' }),
    );
    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
        serviceScopes: ['core.workflow-runs:write', 'core.workflow-runs:read'],
      },
      'scope-secret',
      { expiresIn: '5m' },
    );

    const context = buildExecutionContext(
      `Bearer ${token}`,
      GuardScopeTestController.prototype.writeHandler,
      GuardScopeTestController,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects service token when required scope is missing', () => {
    const guard = new InternalServiceScopeGuard(
      new Reflector(),
      new ConfigService({ JWT_SECRET: 'scope-secret' }),
    );
    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
        serviceScopes: ['core.workflow-runs:read'],
      },
      'scope-secret',
      { expiresIn: '5m' },
    );

    const context = buildExecutionContext(
      `Bearer ${token}`,
      GuardScopeTestController.prototype.writeHandler,
      GuardScopeTestController,
    );

    expect(() => guard.canActivate(context)).toThrow(
      /missing required scopes/i,
    );
  });

  it('skips scope checks for non-service tokens', () => {
    const guard = new InternalServiceScopeGuard(
      new Reflector(),
      new ConfigService({ JWT_SECRET: 'scope-secret' }),
    );
    const token = jwt.sign(
      {
        sub: 'user-1',
        roles: ['Admin'],
      },
      'scope-secret',
      { expiresIn: '5m' },
    );

    const context = buildExecutionContext(
      `Bearer ${token}`,
      GuardScopeTestController.prototype.writeHandler,
      GuardScopeTestController,
    );

    expect(guard.canActivate(context)).toBe(true);
  });
});

function buildExecutionContext(
  authorization: string,
  handler: (...args: unknown[]) => unknown,
  controllerClass: new (...args: unknown[]) => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization },
      }),
    }),
  };
}
