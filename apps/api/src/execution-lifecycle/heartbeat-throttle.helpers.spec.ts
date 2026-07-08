import { describe, expect, it } from 'vitest';
import {
  shouldEmitHeartbeat,
  HEARTBEAT_MIN_INTERVAL_MS,
} from './heartbeat-throttle.helpers';

describe('shouldEmitHeartbeat', () => {
  it('returns true when no prior heartbeat has been emitted', () => {
    expect(shouldEmitHeartbeat(undefined, 1_000)).toBe(true);
  });

  it('returns false when within the minimum interval', () => {
    const now = 100_000;
    expect(
      shouldEmitHeartbeat(now - (HEARTBEAT_MIN_INTERVAL_MS - 1), now),
    ).toBe(false);
  });

  it('returns true once the minimum interval has elapsed', () => {
    const now = 100_000;
    expect(shouldEmitHeartbeat(now - HEARTBEAT_MIN_INTERVAL_MS, now)).toBe(
      true,
    );
  });

  it('returns true when interval has been exceeded', () => {
    const now = 100_000;
    expect(
      shouldEmitHeartbeat(now - (HEARTBEAT_MIN_INTERVAL_MS + 1), now),
    ).toBe(true);
  });

  it('respects a custom minIntervalMs override', () => {
    const customInterval = 5_000;
    const now = 100_000;
    expect(
      shouldEmitHeartbeat(now - (customInterval - 1), now, customInterval),
    ).toBe(false);
    expect(shouldEmitHeartbeat(now - customInterval, now, customInterval)).toBe(
      true,
    );
  });
});
