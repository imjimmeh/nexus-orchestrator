import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, computeExponentialBackoffMs } from './async.utils';

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the specified duration', async () => {
    const p = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('computeExponentialBackoffMs', () => {
  it('returns base delay on attempt 0', () => {
    expect(computeExponentialBackoffMs(0, { baseMs: 1000, maxMs: 30000 })).toBe(
      1000,
    );
  });

  it('doubles on each attempt', () => {
    expect(computeExponentialBackoffMs(1, { baseMs: 1000, maxMs: 30000 })).toBe(
      2000,
    );
    expect(computeExponentialBackoffMs(2, { baseMs: 1000, maxMs: 30000 })).toBe(
      4000,
    );
  });

  it('clamps at maxMs', () => {
    expect(
      computeExponentialBackoffMs(10, { baseMs: 1000, maxMs: 30000 }),
    ).toBe(30000);
  });

  it('respects optional jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = computeExponentialBackoffMs(0, {
      baseMs: 1000,
      maxMs: 30000,
      jitter: true,
    });
    // With random=0.5, jitter adds 0.5 * baseMs = 500ms → base(1000) + jitter(500) = 1500, clamped to 30000
    expect(result).toBe(1500);
    vi.restoreAllMocks();
  });
});
