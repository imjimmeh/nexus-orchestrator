import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { InSessionTransientRetryConfig } from './step-agent-step-executor.multistep.types';

const IN_SESSION_RETRY_ENABLED_KEY =
  'workflow_in_session_transient_retry_enabled';
const IN_SESSION_RETRY_MAX_ATTEMPTS_KEY =
  'workflow_in_session_transient_retry_max_attempts';
const IN_SESSION_RETRY_MAX_DURATION_MS_KEY =
  'workflow_in_session_transient_retry_max_duration_ms';
const IN_SESSION_RETRY_INITIAL_DELAY_MS_KEY =
  'workflow_in_session_transient_retry_initial_delay_ms';
const IN_SESSION_RETRY_MAX_DELAY_MS_KEY =
  'workflow_in_session_transient_retry_max_delay_ms';
const IN_SESSION_RETRY_BACKOFF_MULTIPLIER_KEY =
  'workflow_in_session_transient_retry_backoff_multiplier';
const IN_SESSION_RETRY_JITTER_RATIO_KEY =
  'workflow_in_session_transient_retry_jitter_ratio';
const IN_SESSION_RETRY_429_UNBOUNDED_KEY =
  'workflow_in_session_transient_retry_429_unbounded';
const IN_SESSION_RETRY_529_UNBOUNDED_KEY =
  'workflow_in_session_transient_retry_529_unbounded';

export const IN_SESSION_RETRY_DEFAULTS: InSessionTransientRetryConfig = {
  enabled: true,
  maxAttempts: 5,
  maxDurationMs: 0,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  retry429Unbounded: true,
  retry529Unbounded: true,
};

export function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    if (value === 'true' || value === '1') {
      return true;
    }
    if (value === 'false' || value === '0') {
      return false;
    }
  }

  return fallback;
}

export function toNumber(
  value: unknown,
  fallback: number,
  bounds?: { min?: number; max?: number; integer?: boolean },
): number {
  let parsed = Number.NaN;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    parsed = Number(value);
  }

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  let normalized = parsed;
  if (bounds?.integer) {
    normalized = Math.trunc(normalized);
  }
  if (typeof bounds?.min === 'number') {
    normalized = Math.max(bounds.min, normalized);
  }
  if (typeof bounds?.max === 'number') {
    normalized = Math.min(bounds.max, normalized);
  }

  return normalized;
}

export async function loadInSessionTransientRetryConfig(
  settings: SystemSettingsService,
): Promise<InSessionTransientRetryConfig> {
  const enabledRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_ENABLED_KEY,
    IN_SESSION_RETRY_DEFAULTS.enabled,
  );
  const maxAttemptsRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_MAX_ATTEMPTS_KEY,
    IN_SESSION_RETRY_DEFAULTS.maxAttempts,
  );
  const maxDurationRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_MAX_DURATION_MS_KEY,
    IN_SESSION_RETRY_DEFAULTS.maxDurationMs,
  );
  const initialDelayRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_INITIAL_DELAY_MS_KEY,
    IN_SESSION_RETRY_DEFAULTS.initialDelayMs,
  );
  const maxDelayRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_MAX_DELAY_MS_KEY,
    IN_SESSION_RETRY_DEFAULTS.maxDelayMs,
  );
  const multiplierRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_BACKOFF_MULTIPLIER_KEY,
    IN_SESSION_RETRY_DEFAULTS.backoffMultiplier,
  );
  const jitterRaw = await settings.get<unknown>(
    IN_SESSION_RETRY_JITTER_RATIO_KEY,
    IN_SESSION_RETRY_DEFAULTS.jitterRatio,
  );
  const retry429Raw = await settings.get<unknown>(
    IN_SESSION_RETRY_429_UNBOUNDED_KEY,
    IN_SESSION_RETRY_DEFAULTS.retry429Unbounded,
  );
  const retry529Raw = await settings.get<unknown>(
    IN_SESSION_RETRY_529_UNBOUNDED_KEY,
    IN_SESSION_RETRY_DEFAULTS.retry529Unbounded,
  );

  const initialDelayMs = toNumber(
    initialDelayRaw,
    IN_SESSION_RETRY_DEFAULTS.initialDelayMs,
    { min: 1000, integer: true },
  );
  const maxDelayMs = toNumber(
    maxDelayRaw,
    IN_SESSION_RETRY_DEFAULTS.maxDelayMs,
    { min: initialDelayMs, integer: true },
  );

  return {
    enabled: toBoolean(enabledRaw, IN_SESSION_RETRY_DEFAULTS.enabled),
    maxAttempts: toNumber(
      maxAttemptsRaw,
      IN_SESSION_RETRY_DEFAULTS.maxAttempts,
      { min: 1, integer: true },
    ),
    maxDurationMs: toNumber(
      maxDurationRaw,
      IN_SESSION_RETRY_DEFAULTS.maxDurationMs,
      { min: 0, integer: true },
    ),
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier: toNumber(
      multiplierRaw,
      IN_SESSION_RETRY_DEFAULTS.backoffMultiplier,
      { min: 1 },
    ),
    jitterRatio: toNumber(jitterRaw, IN_SESSION_RETRY_DEFAULTS.jitterRatio, {
      min: 0,
      max: 1,
    }),
    retry429Unbounded: toBoolean(
      retry429Raw,
      IN_SESSION_RETRY_DEFAULTS.retry429Unbounded,
    ),
    retry529Unbounded: toBoolean(
      retry529Raw,
      IN_SESSION_RETRY_DEFAULTS.retry529Unbounded,
    ),
  };
}
