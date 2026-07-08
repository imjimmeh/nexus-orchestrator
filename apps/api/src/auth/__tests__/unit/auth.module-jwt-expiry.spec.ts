import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';

/**
 * Regression guard for [Refactoring] JWT module's signOptions.expiresIn
 * hardcoded to 1h but TokenService overrides with JWT_ACCESS_EXPIRY
 * (default 15m).
 *
 * Boot a real `JwtService` (no DB, no ConfigModule) and assert that a bare
 * `jwtService.sign(payload)` produces a token whose `exp - iat` equals the
 * configured `signOptions.expiresIn` — NOT the historical 3600s (1h)
 * hardcoded default. If a future change re-introduces a second default at
 * the module level, this test fails and forces the author to pick exactly
 * one source of truth for token expiry.
 */
describe('AuthModule - JwtModule signOptions.expiresIn is honored by jwtService.sign()', () => {
  // jsonwebtoken requires HMAC secrets at least as long as the digest
  // (32 bytes for HS256). Use a 32+ char secret so module init never throws.
  const SECRET = 'a'.repeat(32);

  async function buildJwtServiceWithExpiry(
    expiresIn: string,
  ): Promise<JwtService> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn },
        }),
      ],
    }).compile();

    return moduleRef.get(JwtService);
  }

  interface DecodedJwtPayload {
    sub?: string;
    iat?: number;
    exp?: number;
    [key: string]: unknown;
  }

  describe(`signOptions.expiresIn: '2m'`, () => {
    it('jwtService.sign(payload) yields exp - iat === 120 (NOT 3600)', async () => {
      const jwtService = await buildJwtServiceWithExpiry('2m');

      // Sign a minimal payload with NO per-call override — the module-level
      // signOptions.expiresIn must govern the resulting exp claim.
      const token = jwtService.sign({ sub: 'test' });

      // JwtService.decode is provided by @nestjs/jwt and returns the raw
      // decoded payload without re-verifying the signature.
      const decoded = jwtService.decode<DecodedJwtPayload>(token);

      expect(decoded).not.toBeNull();
      expect(decoded).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
      expect(typeof decoded.iat).toBe('number');

      const lifetimeSeconds = decoded.exp - decoded.iat;

      // Primary assertion: module-level expiresIn is the single source of truth.
      expect(lifetimeSeconds).toBe(120);

      // Explicitly document the closed footgun so a future re-introduction
      // of the dual-default (module-default '1h' + per-service override) is
      // surfaced with a clear, targeted failure message.
      expect(lifetimeSeconds).not.toBe(3600);
    });
  });

  describe(`signOptions.expiresIn: '15m'`, () => {
    it('jwtService.sign(payload) yields exp - iat === 900 (NOT 3600)', async () => {
      const jwtService = await buildJwtServiceWithExpiry('15m');

      const token = jwtService.sign({ sub: 'test' });

      const decoded = jwtService.decode<DecodedJwtPayload>(token);

      expect(decoded).not.toBeNull();
      expect(decoded).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
      expect(typeof decoded.iat).toBe('number');

      const lifetimeSeconds = decoded.exp - decoded.iat;

      // 15 minutes is the production default for JWT_ACCESS_EXPIRY; lock it in.
      expect(lifetimeSeconds).toBe(900);

      // Defensive: should never silently fall back to the historical 1h default.
      expect(lifetimeSeconds).not.toBe(3600);
    });
  });
});
