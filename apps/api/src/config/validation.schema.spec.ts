import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REFRESH_TOKEN_HMAC_KEY_FALLBACK_LABEL,
  REFRESH_TOKEN_HMAC_KEY_SOURCE_ENV,
  validateEnv,
} from './validation.schema';

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'nexus',
  JWT_SECRET: 'a'.repeat(32),
  SECRET_ENCRYPTION_KEY: 'b'.repeat(32),
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  CORS_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test',
};

describe('validateEnv', () => {
  it('requires security-sensitive runtime configuration', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: undefined })).toThrow(
      /JWT_SECRET/,
    );
    expect(() =>
      validateEnv({ ...validEnv, SECRET_ENCRYPTION_KEY: undefined }),
    ).toThrow(/SECRET_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...validEnv, REDIS_HOST: undefined })).toThrow(
      /REDIS_HOST/,
    );
    expect(() => validateEnv({ ...validEnv, CORS_ORIGIN: undefined })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it('accepts explicit valid runtime configuration', () => {
    expect(validateEnv(validEnv).JWT_SECRET).toBe(validEnv.JWT_SECRET);
  });

  describe('REFRESH_TOKEN_HMAC_KEY', () => {
    it('derives a stable key from JWT_SECRET when the env var is unset', () => {
      const result = validateEnv(validEnv);

      const expected = createHash('sha256')
        .update(validEnv.JWT_SECRET)
        .digest('hex');
      expect(result.REFRESH_TOKEN_HMAC_KEY).toBe(expected);
      expect(result.REFRESH_TOKEN_HMAC_KEY).toHaveLength(64);
      expect(result.REFRESH_TOKEN_HMAC_KEY_SOURCE).toBe(
        REFRESH_TOKEN_HMAC_KEY_FALLBACK_LABEL,
      );
    });

    it('preserves an explicit env-provided key that meets the length floor', () => {
      const explicit = 'c'.repeat(32);
      const result = validateEnv({
        ...validEnv,
        REFRESH_TOKEN_HMAC_KEY: explicit,
      });

      expect(result.REFRESH_TOKEN_HMAC_KEY).toBe(explicit);
      expect(result.REFRESH_TOKEN_HMAC_KEY_SOURCE).toBe(
        REFRESH_TOKEN_HMAC_KEY_SOURCE_ENV,
      );
    });

    it('rejects an explicit env-provided key shorter than 32 characters', () => {
      expect(() =>
        validateEnv({ ...validEnv, REFRESH_TOKEN_HMAC_KEY: 'short' }),
      ).toThrow(/REFRESH_TOKEN_HMAC_KEY/);
    });
  });

  describe('JWT_REFRESH_EXPIRY_DAYS', () => {
    it('coerces JWT_REFRESH_EXPIRY_DAYS from numeric string to number', () => {
      const env = validateEnv({ ...validEnv, JWT_REFRESH_EXPIRY_DAYS: '14' });
      expect(env.JWT_REFRESH_EXPIRY_DAYS).toBe(14);
      expect(typeof env.JWT_REFRESH_EXPIRY_DAYS).toBe('number');
    });

    it('accepts an absent JWT_REFRESH_EXPIRY_DAYS', () => {
      expect(() => validateEnv({ ...validEnv })).not.toThrow();
    });

    it('throws with JWT_REFRESH_EXPIRY_DAYS path when value is not numeric', () => {
      expect(() =>
        validateEnv({ ...validEnv, JWT_REFRESH_EXPIRY_DAYS: 'not-a-number' }),
      ).toThrow(/JWT_REFRESH_EXPIRY_DAYS/);
    });

    it('coerces JWT_REFRESH_REMEMBER_ME_DAYS from numeric string to number', () => {
      const env = validateEnv({
        ...validEnv,
        JWT_REFRESH_REMEMBER_ME_DAYS: '30',
      });
      expect(env.JWT_REFRESH_REMEMBER_ME_DAYS).toBe(30);
      expect(typeof env.JWT_REFRESH_REMEMBER_ME_DAYS).toBe('number');
    });

    it('accepts an absent JWT_REFRESH_REMEMBER_ME_DAYS', () => {
      expect(() => validateEnv({ ...validEnv })).not.toThrow();
    });

    it('throws with JWT_REFRESH_REMEMBER_ME_DAYS path when value is not numeric', () => {
      expect(() =>
        validateEnv({
          ...validEnv,
          JWT_REFRESH_REMEMBER_ME_DAYS: 'not-a-number',
        }),
      ).toThrow(/JWT_REFRESH_REMEMBER_ME_DAYS/);
    });
  });

  describe('PUBLIC_APP_URL and SMTP config', () => {
    it('accepts SMTP + PUBLIC_APP_URL config', () => {
      const result = validateEnv({
        ...validEnv,
        PUBLIC_APP_URL: 'https://app.example.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'mailer',
        SMTP_SECURE: 'false',
        SMTP_FROM: 'Nexus <no-reply@example.com>',
        SMTP_PASSWORD_SECRET_ID: 'a3f1c2e4-1234-4abc-8def-000000000000',
      });
      expect(result.PUBLIC_APP_URL).toBe('https://app.example.com');
      expect(result.SMTP_HOST).toBe('smtp.example.com');
      expect(result.SMTP_PORT).toBe(587);
      expect(result.SMTP_SECURE).toBe(false);
    });

    it('defaults PUBLIC_APP_URL and leaves SMTP unset when omitted', () => {
      const result = validateEnv(validEnv);
      expect(result.PUBLIC_APP_URL).toBe('http://localhost:3120');
      expect(result.SMTP_HOST).toBeUndefined();
      expect(result.SMTP_PORT).toBe(587);
      expect(result.SMTP_SECURE).toBe(false);
    });

    it('treats blank SMTP env vars as absent (cp .env.example without editing)', () => {
      const result = validateEnv({
        ...validEnv,
        SMTP_HOST: '',
        SMTP_PORT: '',
        SMTP_USER: '',
        SMTP_SECURE: '',
        SMTP_FROM: '',
        SMTP_PASSWORD: '',
        SMTP_PASSWORD_SECRET_ID: '',
      });
      expect(result.SMTP_HOST).toBeUndefined();
      expect(result.SMTP_USER).toBeUndefined();
      expect(result.SMTP_FROM).toBeUndefined();
      expect(result.SMTP_PASSWORD).toBeUndefined();
      expect(result.SMTP_PASSWORD_SECRET_ID).toBeUndefined();
      expect(result.SMTP_PORT).toBe(587);
      expect(result.SMTP_SECURE).toBe(false);
    });

    it('treats a blank PUBLIC_APP_URL as absent and applies the default (does not crash)', () => {
      const result = validateEnv({ ...validEnv, PUBLIC_APP_URL: '' });
      expect(result.PUBLIC_APP_URL).toBe('http://localhost:3120');
    });
  });
});
