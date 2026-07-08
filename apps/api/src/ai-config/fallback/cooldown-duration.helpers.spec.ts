import { describe, it, expect } from 'vitest';
import { deriveCooldownUntil } from './cooldown-duration.helpers';

describe('deriveCooldownUntil', () => {
  const now = new Date('2026-06-29T00:00:00.000Z');
  it('honors a valid future resetAt', () => {
    const out = deriveCooldownUntil({
      reason: 'usage_exhausted',
      resetAt: '2026-06-29T01:00:00.000Z',
      now,
    });
    expect(out.toISOString()).toBe('2026-06-29T01:00:00.000Z');
  });
  it('falls back to the per-reason default when resetAt is absent', () => {
    const out = deriveCooldownUntil({ reason: 'provider_outage', now });
    expect(out.toISOString()).toBe('2026-06-29T00:02:00.000Z'); // 2 min
  });
  it('ignores a past resetAt and uses the default', () => {
    const out = deriveCooldownUntil({
      reason: 'usage_exhausted',
      resetAt: '2020-01-01T00:00:00.000Z',
      now,
    });
    expect(out.toISOString()).toBe('2026-06-29T00:30:00.000Z'); // 30 min
  });
});
