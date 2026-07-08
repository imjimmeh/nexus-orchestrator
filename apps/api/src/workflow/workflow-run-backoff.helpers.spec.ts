import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  calculateRetryDelayMs,
  resolveRetryDelayMs,
} from './workflow-run-backoff.helpers';
import { getAutoRetryConfig } from './workflow-run-auto-retry-config.helpers';
import type { SystemSettingsService } from '../settings/system-settings.service';

async function buildConfig(
  overrides: Partial<{
    enabled: boolean;
    maxAttempts: number;
    maxDurationMs: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterRatio: number;
    maxInFlight: number;
  }> = {},
): Promise<Awaited<ReturnType<typeof getAutoRetryConfig>>> {
  const systemSettings = {
    get: vi
      .fn()
      .mockImplementation(async (key: string, defaultValue: unknown) => {
        const store: Record<string, unknown> = {
          workflow_auto_retry_enabled: overrides.enabled ?? true,
          workflow_auto_retry_max_attempts: overrides.maxAttempts ?? 4,
          workflow_auto_retry_max_duration_ms:
            overrides.maxDurationMs ?? 86400000,
          workflow_auto_retry_initial_delay_ms:
            overrides.initialDelayMs ?? 60000,
          workflow_auto_retry_max_delay_ms: overrides.maxDelayMs ?? 300000,
          workflow_auto_retry_backoff_multiplier:
            overrides.backoffMultiplier ?? 2,
          workflow_auto_retry_jitter_ratio: overrides.jitterRatio ?? 0,
          workflow_auto_retry_max_in_flight: overrides.maxInFlight ?? 5,
        };
        return key in store ? store[key] : defaultValue;
      }),
  } as unknown as SystemSettingsService;
  return await getAutoRetryConfig(systemSettings);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculateRetryDelayMs', () => {
  it('grows exponentially across attempts and caps at maxDelayMs', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 300000,
      backoffMultiplier: 2,
      jitterRatio: 0,
    });

    expect(calculateRetryDelayMs(config, 1)).toBe(60000);
    expect(calculateRetryDelayMs(config, 2)).toBe(120000);
    expect(calculateRetryDelayMs(config, 3)).toBe(240000);
    // attempt 4 would be 480000 but capped at maxDelayMs.
    expect(calculateRetryDelayMs(config, 4)).toBe(300000);
    expect(calculateRetryDelayMs(config, 10)).toBe(300000);
  });

  it('keeps jitter offsets bounded between -baseDelay*ratio and +baseDelay*ratio', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 300000,
      backoffMultiplier: 2,
      jitterRatio: 0.2,
    });

    // attempt 2 => baseDelay=120000, jitterWindow=24000 => offset in [-24000, 24000]
    const attempt2Lower = 120000 - 24000;
    const attempt2Upper = 120000 + 24000;
    for (let i = 0; i < 25; i += 1) {
      const delay = calculateRetryDelayMs(config, 2);
      expect(delay).toBeGreaterThanOrEqual(attempt2Lower);
      expect(delay).toBeLessThanOrEqual(attempt2Upper);
    }
  });

  it('returns baseDelay unchanged when jitterRatio is 0', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 300000,
      backoffMultiplier: 2,
      jitterRatio: 0,
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const expected = Math.min(
        Math.round(60000 * Math.pow(2, Math.max(attempt - 1, 0))),
        300000,
      );
      expect(calculateRetryDelayMs(config, attempt)).toBe(expected);
    }
  });

  it('uses attempt-1 as the exponent so first retry equals initialDelayMs', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 600000,
      backoffMultiplier: 3,
      jitterRatio: 0,
    });

    expect(calculateRetryDelayMs(config, 1)).toBe(60000);
    expect(calculateRetryDelayMs(config, 2)).toBe(180000);
    expect(calculateRetryDelayMs(config, 3)).toBe(540000);
  });
});

describe('resolveRetryDelayMs', () => {
  it('prefers the override when it is finite and above the minimum-delay floor', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 600000,
    });

    const delay = resolveRetryDelayMs({
      retryConfig: config,
      nextAttempt: 1,
      overrideDelayMs: 180000,
    });

    expect(delay).toBe(180000);
  });

  it('applies the minimum-delay floor to overrides (60000ms)', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 600000,
    });

    expect(
      resolveRetryDelayMs({
        retryConfig: config,
        nextAttempt: 1,
        overrideDelayMs: 1000,
      }),
    ).toBe(60000);
  });

  it('falls back to the calculated delay when the override is non-finite', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 600000,
      backoffMultiplier: 2,
      jitterRatio: 0,
    });

    // nextAttempt=2 => base 120000, multiplier applied; no override means calculate wins.
    expect(
      resolveRetryDelayMs({
        retryConfig: config,
        nextAttempt: 2,
        overrideDelayMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(120000);
    expect(
      resolveRetryDelayMs({
        retryConfig: config,
        nextAttempt: 2,
        overrideDelayMs: Number.NaN,
      }),
    ).toBe(120000);
  });

  it('falls back to the calculated delay when no override is provided', async () => {
    const config = await buildConfig({
      initialDelayMs: 60000,
      maxDelayMs: 600000,
      backoffMultiplier: 2,
      jitterRatio: 0,
    });

    expect(resolveRetryDelayMs({ retryConfig: config, nextAttempt: 1 })).toBe(
      60000,
    );
    expect(resolveRetryDelayMs({ retryConfig: config, nextAttempt: 3 })).toBe(
      240000,
    );
  });
});
