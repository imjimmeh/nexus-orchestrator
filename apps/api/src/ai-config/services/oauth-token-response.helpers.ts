// apps/api/src/ai-config/services/oauth-token-response.helpers.ts
import { UnprocessableEntityException } from '@nestjs/common';
import type { ValidatedAuthorizationCodeTokens } from './oauth-token-response.helpers.types';

export type { ValidatedAuthorizationCodeTokens } from './oauth-token-response.helpers.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an authorization-code grant token response, asserting the presence
 * of the access token, refresh token, and a positive numeric `expires_in`.
 * Throws an actionable {@link UnprocessableEntityException} on any violation.
 */
export function validateAuthorizationCodeTokenResponse(
  tokens: unknown,
): ValidatedAuthorizationCodeTokens {
  if (!isRecord(tokens)) {
    throw new UnprocessableEntityException(
      'Invalid token response: expected an object',
    );
  }

  if (typeof tokens.access_token !== 'string') {
    throw new UnprocessableEntityException(
      'Invalid token response: missing access_token',
    );
  }

  if (typeof tokens.refresh_token !== 'string') {
    throw new UnprocessableEntityException(
      'Invalid token response: missing refresh_token',
    );
  }

  const expiresIn =
    typeof tokens.expires_in === 'number'
      ? tokens.expires_in
      : typeof tokens.expires_in === 'string'
        ? Number(tokens.expires_in)
        : NaN;

  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new UnprocessableEntityException(
      'Invalid token response: invalid expires_in',
    );
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: expiresIn,
    scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
    token_type:
      typeof tokens.token_type === 'string' ? tokens.token_type : undefined,
  };
}
