import { SystemSettingsService } from '../settings/system-settings.service';

const WORKFLOW_AUTO_RETRY_ENABLED_KEY = 'workflow_auto_retry_enabled';
const WORKFLOW_AUTO_RETRY_MAX_ATTEMPTS_KEY = 'workflow_auto_retry_max_attempts';
const WORKFLOW_AUTO_RETRY_INITIAL_DELAY_MS_KEY =
  'workflow_auto_retry_initial_delay_ms';
const WORKFLOW_AUTO_RETRY_MAX_DELAY_MS_KEY = 'workflow_auto_retry_max_delay_ms';
const WORKFLOW_AUTO_RETRY_BACKOFF_MULTIPLIER_KEY =
  'workflow_auto_retry_backoff_multiplier';
const WORKFLOW_AUTO_RETRY_JITTER_RATIO_KEY = 'workflow_auto_retry_jitter_ratio';
const WORKFLOW_AUTO_RETRY_MAX_IN_FLIGHT_KEY =
  'workflow_auto_retry_max_in_flight';
const WORKFLOW_AUTO_RETRY_MINIMUM_DELAY_MS = 60000;

interface WorkflowAutoRetryConfig {
  enabled: boolean;
  maxAttempts: number;
  maxDurationMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  maxInFlight: number;
}

const WORKFLOW_AUTO_RETRY_DEFAULTS: WorkflowAutoRetryConfig = {
  enabled: false,
  maxAttempts: 2,
  maxDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  initialDelayMs: WORKFLOW_AUTO_RETRY_MINIMUM_DELAY_MS,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  maxInFlight: 5,
};

export async function getAutoRetryConfig(
  systemSettings: SystemSettingsService,
): Promise<WorkflowAutoRetryConfig> {
  const enabledRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_ENABLED_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.enabled,
  );
  const maxAttemptsRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_MAX_ATTEMPTS_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.maxAttempts,
  );
  const maxDurationRaw = await systemSettings.get<unknown>(
    'workflow_auto_retry_max_duration_ms',
    WORKFLOW_AUTO_RETRY_DEFAULTS.maxDurationMs,
  );
  const initialDelayRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_INITIAL_DELAY_MS_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.initialDelayMs,
  );
  const maxDelayRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_MAX_DELAY_MS_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.maxDelayMs,
  );
  const backoffMultiplierRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_BACKOFF_MULTIPLIER_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.backoffMultiplier,
  );
  const jitterRatioRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_JITTER_RATIO_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.jitterRatio,
  );
  const maxInFlightRaw = await systemSettings.get<unknown>(
    WORKFLOW_AUTO_RETRY_MAX_IN_FLIGHT_KEY,
    WORKFLOW_AUTO_RETRY_DEFAULTS.maxInFlight,
  );

  const initialDelayMs = toNumber(
    initialDelayRaw,
    WORKFLOW_AUTO_RETRY_DEFAULTS.initialDelayMs,
    { min: WORKFLOW_AUTO_RETRY_MINIMUM_DELAY_MS, integer: true },
  );

  const maxDelayMs = toNumber(
    maxDelayRaw,
    WORKFLOW_AUTO_RETRY_DEFAULTS.maxDelayMs,
    { min: initialDelayMs, integer: true },
  );

  return {
    enabled: toBoolean(enabledRaw, WORKFLOW_AUTO_RETRY_DEFAULTS.enabled),
    maxAttempts: toNumber(
      maxAttemptsRaw,
      WORKFLOW_AUTO_RETRY_DEFAULTS.maxAttempts,
      { min: 1, integer: true },
    ),
    maxDurationMs: toNumber(
      maxDurationRaw,
      WORKFLOW_AUTO_RETRY_DEFAULTS.maxDurationMs,
      { min: 0, integer: true },
    ),
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier: toNumber(
      backoffMultiplierRaw,
      WORKFLOW_AUTO_RETRY_DEFAULTS.backoffMultiplier,
      { min: 1 },
    ),
    jitterRatio: toNumber(
      jitterRatioRaw,
      WORKFLOW_AUTO_RETRY_DEFAULTS.jitterRatio,
      { min: 0, max: 1 },
    ),
    maxInFlight: toNumber(
      maxInFlightRaw,
      WORKFLOW_AUTO_RETRY_DEFAULTS.maxInFlight,
      { min: 1, integer: true },
    ),
  };
}

function toBoolean(value: unknown, fallback: boolean): boolean {
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

function toNumber(
  value: unknown,
  fallback: number,
  bounds?: {
    min?: number;
    max?: number;
    integer?: boolean;
  },
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

  if (bounds?.min !== undefined) {
    normalized = Math.max(bounds.min, normalized);
  }

  if (bounds?.max !== undefined) {
    normalized = Math.min(bounds.max, normalized);
  }

  return normalized;
}
