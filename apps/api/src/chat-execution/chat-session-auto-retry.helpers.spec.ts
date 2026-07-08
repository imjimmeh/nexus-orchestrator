import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SystemSettingsService } from '../settings/system-settings.service';
import {
  getChatSessionAutoRetryConfig,
  resolveChatSessionAutoRetryDecision,
} from './chat-session-auto-retry.helpers';

describe('chat session auto-retry helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads normalized config from system settings', async () => {
    const settings = createSettings({
      chat_session_auto_retry_enabled: 'true',
      chat_session_auto_retry_max_attempts: '4.8',
      chat_session_auto_retry_max_duration_ms: '3600000',
      chat_session_auto_retry_initial_delay_ms: '30000',
      chat_session_auto_retry_max_delay_ms: '120000',
      chat_session_auto_retry_backoff_multiplier: '3',
      chat_session_auto_retry_reset_buffer_ms: '15000',
      chat_session_auto_retry_max_in_flight: '8.9',
    });

    await expect(getChatSessionAutoRetryConfig(settings)).resolves.toEqual({
      enabled: true,
      maxAttempts: 4,
      maxDurationMs: 3600000,
      initialDelayMs: 30000,
      maxDelayMs: 120000,
      backoffMultiplier: 3,
      resetBufferMs: 15000,
      maxInFlight: 8,
    });
  });

  it('returns a retry decision with exact reset delay and metadata for enabled 429 usage limits', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T14:00:00Z'));

    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage:
        '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z (2056)',
      currentAttempts: 1,
      config: createConfig({ resetBufferMs: 60000 }),
    });

    expect(decision).toEqual({
      retry: true,
      reasonCode: 'provider_rate_limit_429',
      retryDelayMs: 3660000,
      rateLimitResetAt: '2026-04-29T15:00:00.000Z',
      providerTier: 'Token Plan Starter',
      usageLimit: { used: 1500, limit: 1500, unit: 'tokens' },
    });
  });

  it('retries 429 even when max attempts are reached if within duration cap', () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-01T10:00:00Z');
    vi.setSystemTime(now);

    const firstFailureAt = new Date(now.getTime() - 1000).toISOString(); // 1s ago

    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'Error: HTTP 429 too many requests',
      currentAttempts: 5,
      firstFailureAt,
      config: createConfig({ maxAttempts: 5, maxDurationMs: 3600000 }),
    });

    expect(decision.retry).toBe(true);
    expect(decision.reasonCode).toBe('provider_rate_limit_429');
  });

  it('does not retry 429 when max duration is exceeded', () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-01T10:00:00Z');
    vi.setSystemTime(now);

    const firstFailureAt = new Date(now.getTime() - 4000000).toISOString(); // > 1h ago

    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'Error: HTTP 429 too many requests',
      currentAttempts: 5,
      firstFailureAt,
      config: createConfig({ maxAttempts: 5, maxDurationMs: 3600000 }),
    });

    expect(decision.retry).toBe(false);
    expect(decision.reasonCode).toBe('provider_rate_limit_429');
  });

  it('does not retry when disabled', () => {
    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'Error: HTTP 429 too many requests',
      currentAttempts: 0,
      config: createConfig({ enabled: false }),
    });

    expect(decision).toEqual({
      retry: false,
      reasonCode: 'provider_rate_limit_429',
    });
  });

  it('does not retry 529 when max attempts are reached', () => {
    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'Provider returned status code: 529 high traffic detected',
      currentAttempts: 5,
      config: createConfig({ maxAttempts: 5 }),
    });

    expect(decision).toEqual({
      retry: false,
      reasonCode: 'provider_overload_529',
    });
  });

  it('does not retry generic failures', () => {
    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'workflow id abc429def failed validation',
      currentAttempts: 0,
      config: createConfig(),
    });

    expect(decision).toEqual({
      retry: false,
      reasonCode: 'generic_failure',
    });
  });

  it('uses capped exponential fallback when rate limit has no reset timestamp', () => {
    const decision = resolveChatSessionAutoRetryDecision({
      errorMessage: 'Error: HTTP 429 too many requests',
      currentAttempts: 2,
      config: createConfig({
        initialDelayMs: 1000,
        maxDelayMs: 3500,
        backoffMultiplier: 2,
      }),
    });

    expect(decision).toEqual({
      retry: true,
      reasonCode: 'provider_rate_limit_429',
      retryDelayMs: 3500,
    });
  });
});

function createConfig(overrides = {}) {
  return {
    enabled: true,
    maxAttempts: 5,
    maxDurationMs: 86400000,
    initialDelayMs: 60000,
    maxDelayMs: 3600000,
    backoffMultiplier: 2,
    resetBufferMs: 60000,
    maxInFlight: 20,
    ...overrides,
  };
}

function createSettings(
  values: Record<string, unknown>,
): SystemSettingsService {
  return {
    get: vi.fn(async (key: string, defaultValue: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  } as unknown as SystemSettingsService;
}
