import type { ExecutionContext } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { InternalServiceAuthGuard } from './internal-service-auth.guard';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from './internal-service-scopes.decorator';

const scopedHandler = (): void => {
  return;
};

const unscopedHandler = (): void => {
  return;
};

class ScopedControllerWithMarker {
  protected readonly _marker = 'scoped-controller';
}

Reflect.defineMetadata(
  INTERNAL_SERVICE_SCOPES_METADATA_KEY,
  ['chat.sessions:write'],
  scopedHandler,
);

describe('InternalServiceAuthGuard', () => {
  const previousStaticToken = process.env.CHAT_SERVICE_BEARER_TOKEN;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousAudience = process.env.CHAT_SERVICE_JWT_AUDIENCE;
  const previousIssuer = process.env.CHAT_SERVICE_JWT_ISSUER;

  afterEach(() => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = previousStaticToken;
    process.env.JWT_SECRET = previousJwtSecret;
    process.env.CHAT_SERVICE_JWT_AUDIENCE = previousAudience;
    process.env.CHAT_SERVICE_JWT_ISSUER = previousIssuer;
  });

  it('accepts a valid static bearer token', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = 'chat-internal-token';
    process.env.JWT_SECRET = '';

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext('Bearer chat-internal-token');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('accepts a valid JWT service token when static token is absent', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = 'chat-secret';
    process.env.CHAT_SERVICE_JWT_AUDIENCE = 'nexus-chat-service';
    process.env.CHAT_SERVICE_JWT_ISSUER = 'nexus-api';

    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
      },
      'chat-secret',
      {
        subject: 'api-service',
        audience: 'nexus-chat-service',
        issuer: 'nexus-api',
        expiresIn: '5m',
      },
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects JWT service token missing required route scopes', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = 'chat-secret';
    process.env.CHAT_SERVICE_JWT_AUDIENCE = 'nexus-chat-service';
    process.env.CHAT_SERVICE_JWT_ISSUER = 'nexus-api';

    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
        serviceScopes: ['chat.sessions:read'],
      },
      'chat-secret',
      {
        subject: 'api-service',
        audience: 'nexus-chat-service',
        issuer: 'nexus-api',
        expiresIn: '5m',
      },
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext(
      `Bearer ${token}`,
      scopedHandler,
      ScopedControllerWithMarker,
    );

    expect(() => guard.canActivate(context)).toThrow(
      /missing required scopes/i,
    );
  });

  it('rejects tokens with invalid JWT audience', () => {
    process.env.CHAT_SERVICE_BEARER_TOKEN = '';
    process.env.JWT_SECRET = 'chat-secret';
    process.env.CHAT_SERVICE_JWT_AUDIENCE = 'nexus-chat-service';

    const token = jwt.sign(
      {
        role: 'agent',
        roles: ['Admin', 'Developer'],
      },
      'chat-secret',
      {
        subject: 'api-service',
        audience: 'wrong-audience',
        expiresIn: '5m',
      },
    );

    const guard = new InternalServiceAuthGuard();
    const context = buildExecutionContext(`Bearer ${token}`);

    expect(() => guard.canActivate(context)).toThrow(
      /Invalid internal service token|jwt audience invalid/i,
    );
  });
});

function buildExecutionContext(
  authorization: string,
  handler: (...args: unknown[]) => unknown = unscopedHandler,
  controllerClass: new (
    ...args: unknown[]
  ) => unknown = ScopedControllerWithMarker,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization,
        },
      }),
    }),
  };
}
