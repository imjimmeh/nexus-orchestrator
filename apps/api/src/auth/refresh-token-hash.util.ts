import * as crypto from 'crypto';

/** HMAC algorithm used to derive an indexable, deterministic refresh-token hash. */
const REFRESH_TOKEN_HASH_ALGORITHM = 'sha256';

/** Hex length of a SHA-256 digest (32 bytes → 64 lowercase hex chars). */
const REFRESH_TOKEN_HASH_HEX_LENGTH = 64;

/** Logical byte length of the SHA-256 digest. */
const REFRESH_TOKEN_HASH_BYTE_LENGTH = 32;

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Derives a deterministic, indexable hex hash from an opaque refresh token
 * using HMAC-SHA-256 over the supplied key.
 *
 * The output is 64 lowercase hex characters and can safely be stored in a
 * database column with a unique index, replacing the previous O(n)
 * bcrypt-comparison scan of all stored tokens.
 */
export function hashRefreshToken(plainToken: string, hmacKey: string): string {
  assertNonEmpty('Refresh token', plainToken);
  assertNonEmpty('Refresh token HMAC key', hmacKey);

  const digest = crypto
    .createHmac(REFRESH_TOKEN_HASH_ALGORITHM, hmacKey)
    .update(plainToken)
    .digest();

  if (digest.length !== REFRESH_TOKEN_HASH_BYTE_LENGTH) {
    // Defensive: SHA-256 always yields 32 bytes. This guards against future
    // algorithm swaps that silently change the digest length.
    throw new Error(
      `Unexpected HMAC digest length: ${String(digest.length)} bytes`,
    );
  }

  return digest.toString('hex');
}

/**
 * Verifies a plain refresh token against an expected HMAC-SHA-256 hex hash
 * using a constant-time comparison so callers cannot use response timing to
 * infer the key.
 *
 * Returns false (never throws) when the supplied hash is malformed so a
 * tampered hash cannot be used to probe internal state.
 */
export function verifyRefreshTokenHash(
  plainToken: string,
  expectedHash: string,
  hmacKey: string,
): boolean {
  assertNonEmpty('Refresh token', plainToken);
  assertNonEmpty('Refresh token HMAC key', hmacKey);

  if (typeof expectedHash !== 'string') {
    return false;
  }

  if (expectedHash.length !== REFRESH_TOKEN_HASH_HEX_LENGTH) {
    return false;
  }

  if (!/^[0-9a-f]+$/.test(expectedHash)) {
    return false;
  }

  const computed = crypto
    .createHmac(REFRESH_TOKEN_HASH_ALGORITHM, hmacKey)
    .update(plainToken)
    .digest();

  // Decode the hex-encoded expected hash into its 32 raw bytes so we can
  // run a constant-time compare against the digest.
  const expectedBytes = Buffer.from(expectedHash, 'hex');

  if (expectedBytes.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBytes, computed);
}
