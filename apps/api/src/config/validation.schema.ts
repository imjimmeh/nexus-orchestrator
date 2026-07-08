import { z } from 'zod';
import { createHash } from 'crypto';

/** Minimum acceptable length for the effective refresh-token HMAC key, in chars. */
export const REFRESH_TOKEN_HMAC_KEY_MIN_LENGTH = 32;

/**
 * Source label written to the resolved schema output when the
 * `REFRESH_TOKEN_HMAC_KEY` env var is unset and the key is derived from
 * `JWT_SECRET`. Surfaced via `REFRESH_TOKEN_HMAC_KEY_SOURCE` so operators can
 * tell whether an explicit key was configured at deploy time.
 */
export const REFRESH_TOKEN_HMAC_KEY_FALLBACK_LABEL = 'derived-from-jwt-secret';

/** Source label written to the resolved schema output when an explicit env value is in use. */
export const REFRESH_TOKEN_HMAC_KEY_SOURCE_ENV = 'env';

/**
 * Deterministic, salt-free fallback that keeps existing deployments
 * functional when `REFRESH_TOKEN_HMAC_KEY` has not yet been set. SHA-256 over
 * `JWT_SECRET` is sufficient for an HMAC indexing key because it is used
 * solely to make stored token hashes non-reversible and uniquely indexable.
 */
export function deriveRefreshTokenHmacKeyFromJwtSecret(
  jwtSecret: string,
): string {
  return createHash('sha256').update(jwtSecret).digest('hex');
}

/**
 * Treat an empty string as an absent value. `dotenv` parses a bare `KEY=`
 * line to `''` (not `undefined`), so optional env vars whose `.env.example`
 * ships blank (e.g. the opt-in SMTP block) must coerce `''` back to
 * `undefined` before validation — otherwise a defined-but-empty string fails
 * `.min(1)`/`.uuid()`/`.positive()` checks and crashes the API at boot.
 */
function blankToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const baseEnvSchema = z.object({
  DB_HOST: z.string().min(1, 'Database host is required'),
  DB_PORT: z.coerce
    .number()
    .positive('Database port must be a positive number'),
  DB_USERNAME: z.string().min(1, 'Database username is required'),
  DB_PASSWORD: z.string().min(1, 'Database password is required'),
  DB_DATABASE: z.string().min(1, 'Database name is required'),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  SECRET_ENCRYPTION_KEY: z
    .string()
    .min(32, 'Secret encryption key must be at least 32 characters'),
  REFRESH_TOKEN_HMAC_KEY: z
    .string()
    .min(
      REFRESH_TOKEN_HMAC_KEY_MIN_LENGTH,
      'Refresh token HMAC key must be at least 32 characters',
    )
    .optional(),
  REDIS_HOST: z.string().min(1, 'Redis host is required'),
  REDIS_PORT: z.coerce
    .number()
    .positive('Redis port must be a positive number')
    .default(6379),
  REDIS_PASSWORD: z.string().optional(),
  CORS_ORIGIN: z.string().min(1, 'CORS origin is required'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  /**
   * Legacy fallback that overrides {@link JWT_REFRESH_EXPIRY} when set.
   * Some pre-existing deployments configured refresh-token expiry as a
   * positive integer number of days rather than as a duration string
   * (e.g. `7d`); `refresh-token.service.ts` consults this key first to
   * preserve that behavior. New deployments should configure
   * `JWT_REFRESH_EXPIRY` instead.
   */
  JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().optional(),
  /**
   * Remember-me override for refresh-token expiry, expressed as a
   * positive integer number of days. Consumed by
   * `refresh-token.service.ts` alongside the legacy
   * {@link JWT_REFRESH_EXPIRY_DAYS} key when a refresh token is issued
   * with the `rememberMe` flag. When unset, the service falls back to
   * its built-in default (30 days).
   */
  JWT_REFRESH_REMEMBER_ME_DAYS: z.coerce.number().int().positive().optional(),
  PASSWORD_MIN_LENGTH: z.coerce
    .number()
    .min(8, 'Password minimum length must be at least 8')
    .default(12),
  PASSWORD_REQUIRE_UPPERCASE: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_LOWERCASE: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_NUMBERS: z.coerce.boolean().default(true),
  PASSWORD_REQUIRE_SPECIAL: z.coerce.boolean().default(true),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .positive('Rate limit window must be a positive number')
    .default(900000),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce
    .number()
    .positive('Max requests must be a positive number')
    .default(5),
  PORT: z.coerce
    .number()
    .min(1)
    .max(65535, 'Port must be a valid port number (1-65535)')
    .default(3000),
  API_PREFIX: z.string().default('/api'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  SESSION_CHECKPOINT_RESUME_ENABLED: z
    .string()
    .optional()
    .describe(
      'Accepts "true" or "1" to enable session checkpoint resume; all other values (including unset) disable it',
    ),
  PUBLIC_APP_URL: z.preprocess(
    blankToUndefined,
    z
      .string()
      .url('PUBLIC_APP_URL must be a valid URL')
      .default('http://localhost:3120'),
  ),
  SMTP_HOST: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  SMTP_PORT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive('SMTP port must be positive').default(587),
  ),
  SMTP_USER: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  // Not `z.coerce.boolean()`: that coerces any non-empty string (including
  // the literal "false") to `true` via `Boolean(str)`. Parse explicitly so
  // `SMTP_SECURE=false` (and blank) behaves as expected, matching the
  // SESSION_CHECKPOINT_RESUME_ENABLED pattern above.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  SMTP_FROM: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  SMTP_PASSWORD: z.preprocess(blankToUndefined, z.string().optional()),
  SMTP_PASSWORD_SECRET_ID: z.preprocess(
    blankToUndefined,
    z.string().uuid('SMTP_PASSWORD_SECRET_ID must be a UUID').optional(),
  ),
});

export const envSchema = baseEnvSchema.transform((env) => {
  const explicit = env.REFRESH_TOKEN_HMAC_KEY;
  const effective =
    explicit ?? deriveRefreshTokenHmacKeyFromJwtSecret(env.JWT_SECRET);

  if (effective.length < REFRESH_TOKEN_HMAC_KEY_MIN_LENGTH) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['REFRESH_TOKEN_HMAC_KEY'],
        message:
          'Effective refresh token HMAC key must be at least 32 characters',
      },
    ]);
  }

  return {
    ...env,
    REFRESH_TOKEN_HMAC_KEY: effective,
    REFRESH_TOKEN_HMAC_KEY_SOURCE: explicit
      ? REFRESH_TOKEN_HMAC_KEY_SOURCE_ENV
      : REFRESH_TOKEN_HMAC_KEY_FALLBACK_LABEL,
  };
});

type EnvSchema = z.infer<typeof envSchema>;

export type { EnvSchema };

export function validateEnv(
  env: Record<string, string | undefined>,
): EnvSchema {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  return parsed.data;
}
