// apps/api/src/ai-config/services/oauth-refresh.helpers.ts
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';
import type {
  RefreshedOAuthTokens,
  TokenEndpointRefreshParams,
} from './oauth-refresh.helpers.types';

export type { RefreshedOAuthTokens } from './oauth-refresh.helpers.types';

/** Refresh when the access token expires within this window (ms). */
export const OAUTH_REFRESH_BUFFER_MS = 10 * 60 * 1000;

/** Network timeout for the refresh-token POST (ms). */
export const OAUTH_REFRESH_TIMEOUT_MS = 30_000;

/**
 * True when `expiresAt` (epoch ms) is in the past or within the refresh buffer
 * of `now`. A missing/zero `expiresAt` is treated as expiring so a malformed
 * credential is refreshed rather than trusted.
 */
export function isOAuthTokenExpiring(
  expiresAt: number,
  now: number,
  bufferMs: number = OAUTH_REFRESH_BUFFER_MS,
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return true;
  }
  return expiresAt <= now + bufferMs;
}

/**
 * Extracts a client secret from a decrypted secret payload, accepting either
 * the snake_case `client_secret` or camelCase `clientSecret` field. Throws a
 * BadRequestException for malformed or unrecognised payloads.
 */
export function parseClientSecretPayload(decryptedValue: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptedValue);
  } catch {
    throw new BadRequestException(
      'OAuth client secret payload is not valid JSON',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException(
      'OAuth client secret payload is not an object',
    );
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.client_secret === 'string') {
    return record.client_secret;
  }
  if (typeof record.clientSecret === 'string') {
    return record.clientSecret;
  }

  throw new BadRequestException(
    'OAuth client secret payload does not contain a recognisable client secret',
  );
}

/**
 * Builds the pi OAuth credential payload for a refresh from the stored `oauth`
 * blob, falling back to safe defaults for the access token and expiry the pi
 * provider does not strictly require.
 */
export function buildPiRefreshCredentials(
  oauth: Record<string, unknown> | undefined,
  previousRefreshToken: string,
): OAuthCredentials {
  return {
    refresh: previousRefreshToken,
    access: typeof oauth?.accessToken === 'string' ? oauth.accessToken : '',
    expires: typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : 0,
  };
}

/**
 * Maps the credential returned by a pi OAuth provider's `refreshToken` back to
 * {@link RefreshedOAuthTokens}, carrying forward `scope`/`tokenType` from the
 * stored credential since the pi refresh does not return them.
 */
export function mapPiCredentialsToRefreshedTokens(
  next: OAuthCredentials,
  oauth: Record<string, unknown> | undefined,
): RefreshedOAuthTokens {
  return {
    accessToken: next.access,
    refreshToken: next.refresh,
    expiresAt: next.expires,
    scope: typeof oauth?.scope === 'string' ? oauth.scope : undefined,
    tokenType:
      typeof oauth?.tokenType === 'string' ? oauth.tokenType : undefined,
  };
}

/**
 * Performs a form-encoded `refresh_token` grant against a provider's own token
 * endpoint (with an AbortController timeout) and parses the rotated tokens.
 * Surfaces actionable re-authenticate errors on a non-OK response or a
 * malformed body.
 */
export async function postRefreshTokenGrant(
  params: TokenEndpointRefreshParams,
): Promise<RefreshedOAuthTokens> {
  const {
    tokenUrl,
    clientId,
    clientSecret,
    previousRefreshToken,
    providerName,
  } = params;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: previousRefreshToken,
    client_id: clientId,
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, OAUTH_REFRESH_TIMEOUT_MS);

  let json: unknown;
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new UnprocessableEntityException(
        `OAuth refresh failed for '${providerName}' (HTTP ${response.status}); re-authenticate the provider`,
      );
    }
    json = await response.json();
  } finally {
    clearTimeout(timeout);
  }

  try {
    return parseRefreshTokenResponse(json, previousRefreshToken, Date.now());
  } catch {
    throw new UnprocessableEntityException(
      `OAuth refresh for '${providerName}' returned an invalid token response; re-authenticate the provider`,
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

/**
 * Validates a refresh-token grant response and computes the new credential.
 * `refresh_token` is optional on refresh (many providers do not rotate); when
 * absent the prior refresh token is retained.
 */
export function parseRefreshTokenResponse(
  response: unknown,
  previousRefreshToken: string,
  now: number,
): RefreshedOAuthTokens {
  const record =
    typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>)
      : {};

  const accessToken = readString(record.access_token);
  if (!accessToken) {
    throw new Error('OAuth refresh response missing access_token');
  }

  const rawExpiresIn = record.expires_in;
  const expiresIn =
    typeof rawExpiresIn === 'number'
      ? rawExpiresIn
      : typeof rawExpiresIn === 'string'
        ? Number(rawExpiresIn)
        : NaN;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('OAuth refresh response missing numeric expires_in');
  }

  return {
    accessToken,
    refreshToken: readString(record.refresh_token) ?? previousRefreshToken,
    expiresAt: now + expiresIn * 1000,
    scope: readString(record.scope),
    tokenType: readString(record.token_type),
  };
}
