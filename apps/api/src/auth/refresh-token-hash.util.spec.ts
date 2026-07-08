import { describe, expect, it } from 'vitest';
import {
  hashRefreshToken,
  verifyRefreshTokenHash,
} from './refresh-token-hash.util';

const HMAC_KEY_A = 'a'.repeat(32);
const HMAC_KEY_B = 'b'.repeat(32);
const PLAIN_TOKEN = 'opaque-refresh-token-fixture';

describe('hashRefreshToken', () => {
  it('produces a deterministic 64-character hex hash for the same input+key', () => {
    const first = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);
    const second = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash when the key changes', () => {
    const withKeyA = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);
    const withKeyB = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_B);

    expect(withKeyA).not.toBe(withKeyB);
  });

  it('produces a different hash when the plain token changes', () => {
    const tokenOne = hashRefreshToken('token-one', HMAC_KEY_A);
    const tokenTwo = hashRefreshToken('token-two', HMAC_KEY_A);

    expect(tokenOne).not.toBe(tokenTwo);
  });

  it('throws when the HMAC key is empty', () => {
    expect(() => hashRefreshToken(PLAIN_TOKEN, '')).toThrow(
      /Refresh token HMAC key must be a non-empty string/,
    );
  });

  it('throws when the plain token is empty', () => {
    expect(() => hashRefreshToken('', HMAC_KEY_A)).toThrow(
      /Refresh token must be a non-empty string/,
    );
  });
});

describe('verifyRefreshTokenHash', () => {
  it('returns true when the plain token and key match the expected hash', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(verifyRefreshTokenHash(PLAIN_TOKEN, expected, HMAC_KEY_A)).toBe(
      true,
    );
  });

  it('returns false when the expected hash is a single-byte tamper', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);
    const firstChar = expected.charAt(0);
    const replacement = firstChar === 'a' ? 'b' : 'a';
    const tampered = `${replacement}${expected.slice(1)}`;

    expect(tampered).not.toBe(expected);
    expect(tampered).toHaveLength(64);
    expect(verifyRefreshTokenHash(PLAIN_TOKEN, tampered, HMAC_KEY_A)).toBe(
      false,
    );
  });

  it('returns false when the expected hash length is wrong', () => {
    expect(verifyRefreshTokenHash(PLAIN_TOKEN, 'too-short', HMAC_KEY_A)).toBe(
      false,
    );
    expect(
      verifyRefreshTokenHash(PLAIN_TOKEN, 'a'.repeat(63), HMAC_KEY_A),
    ).toBe(false);
    expect(
      verifyRefreshTokenHash(PLAIN_TOKEN, 'a'.repeat(65), HMAC_KEY_A),
    ).toBe(false);
  });

  it('returns false when the plain token does not match', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(
      verifyRefreshTokenHash('different-token', expected, HMAC_KEY_A),
    ).toBe(false);
  });

  it('returns false when the key does not match', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(verifyRefreshTokenHash(PLAIN_TOKEN, expected, HMAC_KEY_B)).toBe(
      false,
    );
  });

  it('throws when the HMAC key is empty', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(() => verifyRefreshTokenHash(PLAIN_TOKEN, expected, '')).toThrow(
      /Refresh token HMAC key must be a non-empty string/,
    );
  });

  it('throws when the plain token is empty', () => {
    const expected = hashRefreshToken(PLAIN_TOKEN, HMAC_KEY_A);

    expect(() => verifyRefreshTokenHash('', expected, HMAC_KEY_A)).toThrow(
      /Refresh token must be a non-empty string/,
    );
  });
});
