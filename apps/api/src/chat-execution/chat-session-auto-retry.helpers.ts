import type { SystemSettingsService } from '../settings/system-settings.service';
import { classifyProviderTransientFailure } from '../llm/provider-transient-failure.helpers';
import type {
  ChatSessionAutoRetryConfig,
  ChatSessionAutoRetryDecision,
} from './chat-session-auto-retry.types';

const CHAT_SESSION_AUTO_RETRY_ENABLED_KEY = 'chat_session_auto_retry_enabled';
const CHAT_SESSION_AUTO_RETRY_MAX_ATTEMPTS_KEY =
  'chat_session_auto_retry_max_attempts';
const CHAT_SESSION_AUTO_RETRY_MAX_DURATION_MS_KEY =
  'chat_session_auto_retry_max_duration_ms';
const CHAT_SESSION_AUTO_RETRY_INITIAL_DELAY_MS_KEY =
  'chat_session_auto_retry_initial_delay_ms';
const CHAT_SESSION_AUTO_RETRY_MAX_DELAY_MS_KEY =
  'chat_session_auto_retry_max_delay_ms';
const CHAT_SESSION_AUTO_RETRY_BACKOFF_MULTIPLIER_KEY =
  'chat_session_auto_retry_backoff_multiplier';
const CHAT_SESSION_AUTO_RETRY_RESET_BUFFER_MS_KEY =
  'chat_session_auto_retry_reset_buffer_ms';
const CHAT_SESSION_AUTO_RETRY_MAX_IN_FLIGHT_KEY =
  'chat_session_auto_retry_max_in_flight';

const CHAT_SESSION_AUTO_RETRY_DEFAULTS: ChatSessionAutoRetryConfig = {
  enabled: true,
  maxAttempts: 5,
  maxDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  initialDelayMs: 60000,
  maxDelayMs: 3600000,
  backoffMultiplier: 2,
  resetBufferMs: 60000,
  maxInFlight: 20,
};

export async function getChatSessionAutoRetryConfig(
  systemSettings: SystemSettingsService,
): Promise<ChatSessionAutoRetryConfig> {
  const enabledRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_ENABLED_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.enabled,
  );
  const maxAttemptsRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_MAX_ATTEMPTS_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxAttempts,
  );
  const maxDurationRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_MAX_DURATION_MS_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxDurationMs,
  );
  const initialDelayRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_INITIAL_DELAY_MS_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.initialDelayMs,
  );
  const maxDelayRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_MAX_DELAY_MS_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxDelayMs,
  );
  const backoffMultiplierRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_BACKOFF_MULTIPLIER_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.backoffMultiplier,
  );
  const resetBufferRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_RESET_BUFFER_MS_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.resetBufferMs,
  );
  const maxInFlightRaw = await systemSettings.get<unknown>(
    CHAT_SESSION_AUTO_RETRY_MAX_IN_FLIGHT_KEY,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxInFlight,
  );

  const initialDelayMs = toNumber(
    initialDelayRaw,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.initialDelayMs,
    { min: 0, integer: true },
  );

  const maxDelayMs = toNumber(
    maxDelayRaw,
    CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxDelayMs,
    { min: initialDelayMs, integer: true },
  );

  return {
    enabled: toBoolean(enabledRaw, CHAT_SESSION_AUTO_RETRY_DEFAULTS.enabled),
    maxAttempts: toNumber(
      maxAttemptsRaw,
      CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxAttempts,
      { min: 1, integer: true },
    ),
    maxDurationMs: toNumber(
      maxDurationRaw,
      CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxDurationMs,
      { min: 0, integer: true },
    ),
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier: toNumber(
      backoffMultiplierRaw,
      CHAT_SESSION_AUTO_RETRY_DEFAULTS.backoffMultiplier,
      { min: 1 },
    ),
    resetBufferMs: toNumber(
      resetBufferRaw,
      CHAT_SESSION_AUTO_RETRY_DEFAULTS.resetBufferMs,
      { min: 0, integer: true },
    ),
    maxInFlight: toNumber(
      maxInFlightRaw,
      CHAT_SESSION_AUTO_RETRY_DEFAULTS.maxInFlight,
      { min: 1, integer: true },
    ),
  };
}

export function resolveChatSessionAutoRetryDecision(params: {
  errorMessage: string;
  currentAttempts: number;
  firstFailureAt?: string | null;
  config: ChatSessionAutoRetryConfig;
}): ChatSessionAutoRetryDecision {
  const classification = classifyProviderTransientFailure({
    message: params.errorMessage,
    resetBufferMs: params.config.resetBufferMs,
  });
  const metadata = {
    rateLimitResetAt: classification.resetAt,
    providerTier: classification.providerTier,
    usageLimit: classification.usageLimit,
  };

  if (!params.config.enabled || !classification.retryable) {
    return {
      retry: false,
      reasonCode: classification.reasonCode,
      ...metadata,
    };
  }

  // Handle 429 Indefinite Retries with Duration Cap
  if (classification.reasonCode === 'provider_rate_limit_429') {
    if (params.firstFailureAt) {
      const durationMs = Date.now() - new Date(params.firstFailureAt).getTime();
      if (durationMs >= params.config.maxDurationMs) {
        return {
          retry: false,
          reasonCode: 'provider_rate_limit_429',
          ...metadata,
        };
      }
    }

    return {
      retry: true,
      reasonCode: 'provider_rate_limit_429',
      retryDelayMs:
        classification.retryDelayMsOverride ??
        getExponentialRetryDelayMs(params.currentAttempts, params.config),
      ...metadata,
    };
  }

  // Handle other transient failures with attempt cap
  if (params.currentAttempts >= params.config.maxAttempts) {
    return {
      retry: false,
      reasonCode: classification.reasonCode,
      ...metadata,
    };
  }

  return {
    retry: true,
    reasonCode: classification.reasonCode,
    retryDelayMs:
      classification.retryDelayMsOverride ??
      getExponentialRetryDelayMs(params.currentAttempts, params.config),
    ...metadata,
  };
}

function getExponentialRetryDelayMs(
  currentAttempts: number,
  config: ChatSessionAutoRetryConfig,
): number {
  const nextAttempt = currentAttempts + 1;
  const delay =
    config.initialDelayMs * config.backoffMultiplier ** (nextAttempt - 1);

  return Math.min(delay, config.maxDelayMs);
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
