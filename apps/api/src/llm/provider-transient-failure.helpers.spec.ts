import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyProviderTransientFailure } from './provider-transient-failure.helpers';

describe('classifyProviderTransientFailure', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies 429 usage limits with reset timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T14:00:00Z'));

    const result = classifyProviderTransientFailure({
      message:
        '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z (2056)',
      resetBufferMs: 60_000,
    });

    expect(result).toMatchObject({
      retryable: true,
      reasonCode: 'provider_rate_limit_429',
      httpStatus: 429,
      resetAt: '2026-04-29T15:00:00.000Z',
      retryDelayMsOverride: 3_660_000,
      providerTier: 'Token Plan Starter',
      usageLimit: { used: 1500, limit: 1500, unit: 'tokens' },
    });
  });

  it('classifies rate limits without reset timestamps as retryable without delay override', () => {
    const result = classifyProviderTransientFailure({
      message: 'Error: HTTP 429 too many requests',
      resetBufferMs: 60_000,
    });

    expect(result).toMatchObject({
      retryable: true,
      reasonCode: 'provider_rate_limit_429',
      httpStatus: 429,
    });
    expect(result.retryDelayMsOverride).toBeUndefined();
  });

  it('classifies 529 provider overload', () => {
    const result = classifyProviderTransientFailure({
      message: 'Provider returned status code: 529 high traffic detected',
      resetBufferMs: 60_000,
    });

    expect(result).toMatchObject({
      retryable: true,
      reasonCode: 'provider_overload_529',
      httpStatus: 529,
    });
  });

  it('does not classify arbitrary numbers containing 429 as a rate limit', () => {
    const result = classifyProviderTransientFailure({
      message: 'workflow id abc429def failed validation',
      resetBufferMs: 60_000,
    });

    expect(result).toMatchObject({
      retryable: false,
      reasonCode: 'generic_failure',
    });
  });
});
