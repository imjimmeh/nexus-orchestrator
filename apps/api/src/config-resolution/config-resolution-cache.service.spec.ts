import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigResolutionCache } from './config-resolution-cache.service';

describe('ConfigResolutionCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const eff = (v: unknown) => ({ value: v }) as any;

  it('returns a cached entry within TTL', () => {
    const cache = new ConfigResolutionCache();
    cache.set('workflow', 'wf', 'scope', eff(1));
    expect(cache.get('workflow', 'wf', 'scope')?.value).toBe(1);
  });

  it('expires entries after the TTL (60s)', () => {
    const cache = new ConfigResolutionCache();
    cache.set('workflow', 'wf', 'scope', eff(1));
    vi.advanceTimersByTime(60_001);
    expect(cache.get('workflow', 'wf', 'scope')).toBeUndefined();
  });

  it('invalidate(objectType, name) clears every scope key for that object', () => {
    const cache = new ConfigResolutionCache();
    cache.set('workflow', 'wf', 'scopeA', eff(1));
    cache.set('workflow', 'wf', 'scopeB', eff(2));
    cache.set('workflow', 'other', 'scopeA', eff(3));
    cache.invalidate('workflow', 'wf');
    expect(cache.get('workflow', 'wf', 'scopeA')).toBeUndefined();
    expect(cache.get('workflow', 'wf', 'scopeB')).toBeUndefined();
    expect(cache.get('workflow', 'other', 'scopeA')?.value).toBe(3);
  });
});
