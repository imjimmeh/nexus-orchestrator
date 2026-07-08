import type { ExecutionContext } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ChatClientAuthGuard } from './chat-client-auth.guard';

const TEST_JWT_SECRET = [
  'chat-client-auth-guard-spec',
  'secret',
  '2026-04-16',
].join(':');

const unscopedHandler = (): void => {
  return;
};

class UnscopedControllerWithMarker {
  protected readonly _marker = 'unscoped-controller';
}

describe('ChatClientAuthGuard', () => {
  const previousStaticToken = process.env.CHAT_SERVICE_BEARER_TOKEN;
  const previousJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = previousStaticToken;
    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('accepts a core-issued user JWT with lowercase app roles', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const token = jwt.sign(
      {
        roles: ['admin'],
      },
      TEST_JWT_SECRET,
      {
        subject: 'user-1',
        expiresIn: '5m',
      },
    );

    const guard = new ChatClientAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a user JWT without any recognized app role', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const token = jwt.sign(
      {
        roles: ['viewer'],
      },
      TEST_JWT_SECRET,
      {
        subject: 'user-1',
        expiresIn: '5m',
      },
    );

    const guard = new ChatClientAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(() => guard.canActivate(context)).toThrow(
      /missing required chat roles/i,
    );
  });

  it('still requires both internal service roles for agent JWTs', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['admin'],
        serviceScopes: ['chat.sessions:read'],
      },
      TEST_JWT_SECRET,
      {
        subject: 'api-service',
        expiresIn: '5m',
      },
    );

    const guard = new ChatClientAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(() => guard.canActivate(context)).toThrow(/missing required roles/i);
  });
});

function buildExecutionContext(authorization: string): ExecutionContext {
  return {
    getHandler: () => unscopedHandler,
    getClass: () => UnscopedControllerWithMarker,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization,
        },
      }),
    }),
  };
}
