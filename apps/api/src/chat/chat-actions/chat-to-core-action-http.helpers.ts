import jwt from 'jsonwebtoken';
import type { ServiceClientHttpOptions } from '@nexus/core';
import {
  SERVICE_JWT_ROLES,
  SERVICE_JWT_SCOPES,
} from '../../config/service-jwt.constants';
import { readCoreErrorMessage } from './chat-to-core-action.utils';

const SERVICE_TOKEN_SUBJECT = 'chat-service';

export function resolveDefaultCoreBaseUrl(): string {
  const port = process.env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}/api`;
}

export function resolveHttpOptions(): ServiceClientHttpOptions {
  const staticToken = readOptionalEnv('CHAT_CORE_BEARER_TOKEN');
  return {
    baseUrl:
      readOptionalEnv('CHAT_CORE_BASE_URL') ?? resolveDefaultCoreBaseUrl(),
    ...(staticToken
      ? { headers: { authorization: `Bearer ${staticToken}` } }
      : {
          authorizationHeaderResolver: () => {
            const token = resolveCoreJwtToken();
            return token ? `Bearer ${token}` : '';
          },
        }),
  };
}

export async function fetchJsonFromCore(params: {
  httpOptions: ServiceClientHttpOptions;
  path: string;
  correlationId: string;
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
  };
}): Promise<unknown> {
  const method = params.options?.method ?? 'GET';
  const headers: Record<string, string> = {
    'x-correlation-id': params.correlationId,
  };

  const requestBody = params.options?.body
    ? JSON.stringify(params.options.body)
    : undefined;
  if (requestBody) {
    headers['content-type'] = 'application/json';
  }

  const authorization = await resolveAuthorizationHeader(params.httpOptions);
  if (authorization) {
    headers.authorization = authorization;
  }

  const response = await fetch(`${params.httpOptions.baseUrl}${params.path}`, {
    method,
    headers,
    body: requestBody,
  });
  const responseBody = await parseResponseBody(response);

  if (!response.ok) {
    const message = readCoreErrorMessage(responseBody) ?? response.statusText;
    throw new Error(message);
  }

  return responseBody;
}

function resolveCoreJwtToken(): string | null {
  const secret = readOptionalEnv('JWT_SECRET');
  if (!secret) {
    return null;
  }

  const audience =
    readOptionalEnv('CHAT_CORE_JWT_AUDIENCE') ?? 'nexus-core-internal';
  const issuer = readOptionalEnv('CHAT_CORE_JWT_ISSUER') ?? 'nexus-chat';
  const expiresIn = (readOptionalEnv('CHAT_CORE_JWT_TTL') ??
    '5m') as jwt.SignOptions['expiresIn'];

  return jwt.sign(
    {
      role: 'agent',
      roles: [...SERVICE_JWT_ROLES],
      service: 'chat',
      serviceScopes: [...SERVICE_JWT_SCOPES],
    },
    secret,
    {
      audience,
      issuer,
      subject: SERVICE_TOKEN_SUBJECT,
      expiresIn,
    },
  );
}

function readOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveAuthorizationHeader(
  httpOptions: ServiceClientHttpOptions,
): Promise<string | null> {
  const staticAuthorization = httpOptions.headers?.authorization;
  if (typeof staticAuthorization === 'string' && staticAuthorization.trim()) {
    return staticAuthorization;
  }

  if (!httpOptions.authorizationHeaderResolver) {
    return null;
  }

  const resolved = await httpOptions.authorizationHeaderResolver();
  const trimmed = resolved.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
