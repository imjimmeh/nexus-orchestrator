// apps/api/src/ai-config/services/oauth-refresh.helpers.spec.ts
import { describe, expect, it } from 'vitest';
import {
  OAUTH_REFRESH_BUFFER_MS,
  isOAuthTokenExpiring,
  parseRefreshTokenResponse,
} from './oauth-refresh.helpers';

describe('isOAuthTokenExpiring', () => {
  const now = 1_000_000_000_000;

  it('is true when the token is already expired', () => {
    expect(isOAuthTokenExpiring(now - 1, now)).toBe(true);
  });

  it('is true when the token expires within the buffer window', () => {
    expect(isOAuthTokenExpiring(now + OAUTH_REFRESH_BUFFER_MS - 1, now)).toBe(
      true,
    );
  });

  it('is false when the token is comfortably valid', () => {
    expect(
      isOAuthTokenExpiring(now + OAUTH_REFRESH_BUFFER_MS + 60_000, now),
    ).toBe(false);
  });
});

describe('parseRefreshTokenResponse', () => {
  it('parses access_token, expires_in, and rotated refresh_token', () => {
    const parsed = parseRefreshTokenResponse(
      {
        access_token: 'new-access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'a b',
      },
      'old-refresh',
      1_000_000_000_000,
    );
    expect(parsed).toEqual({
      accessToken: 'new-access',
      refreshToken: 'rotated-refresh',
      expiresAt: 1_000_000_000_000 + 3600 * 1000,
      scope: 'a b',
      tokenType: 'Bearer',
    });
  });

  it('keeps the previous refresh token when the response omits one', () => {
    const parsed = parseRefreshTokenResponse(
      { access_token: 'new-access', expires_in: 3600 },
      'old-refresh',
      0,
    );
    expect(parsed.refreshToken).toBe('old-refresh');
  });

  it('throws when access_token is missing', () => {
    expect(() =>
      parseRefreshTokenResponse({ expires_in: 3600 }, 'r', 0),
    ).toThrow(/access_token/);
  });

  it('throws when expires_in is missing or non-numeric', () => {
    expect(() =>
      parseRefreshTokenResponse({ access_token: 'a' }, 'r', 0),
    ).toThrow(/expires_in/);
  });

  it('parses a numeric-string expires_in', () => {
    expect(
      parseRefreshTokenResponse(
        { access_token: 'a', expires_in: '3600' },
        'r',
        0,
      ).expiresAt,
    ).toBe(3600 * 1000);
  });

  it('throws when expires_in is zero', () => {
    expect(() =>
      parseRefreshTokenResponse({ access_token: 'a', expires_in: 0 }, 'r', 0),
    ).toThrow(/expires_in/);
  });

  it('throws when expires_in is negative', () => {
    expect(() =>
      parseRefreshTokenResponse({ access_token: 'a', expires_in: -5 }, 'r', 0),
    ).toThrow(/expires_in/);
  });
});
