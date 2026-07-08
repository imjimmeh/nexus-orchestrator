import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFallbackService } from './provider-fallback.service';

const E = (p: string, m: string) => ({ provider_name: p, model_name: m });

describe('ProviderFallbackService.classifyTrigger', () => {
  const svc = new ProviderFallbackService({} as never, {} as never);
  it('maps "out of extra usage" to usage_exhausted', () => {
    expect(svc.classifyTrigger('out of extra usage')?.reason).toBe(
      'usage_exhausted',
    );
  });
  it('maps a 503 to provider_outage', () => {
    expect(svc.classifyTrigger('HTTP 503 service unavailable')?.reason).toBe(
      'provider_outage',
    );
  });
  it('returns null for a plain 429 rate limit', () => {
    expect(svc.classifyTrigger('HTTP 429 rate limit reached')).toBeNull();
  });
});

describe('ProviderFallbackService.handleFailure', () => {
  let cooldowns: {
    upsertCooldown: ReturnType<typeof vi.fn>;
    findActiveProviderNames: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    buildEffectiveChain: ReturnType<typeof vi.fn>;
    selectViableEntry: ReturnType<typeof vi.fn>;
  };
  let svc: ProviderFallbackService;
  const now = new Date('2026-06-29T00:00:00Z');

  beforeEach(() => {
    cooldowns = {
      upsertCooldown: vi.fn().mockResolvedValue(undefined),
      findActiveProviderNames: vi.fn(),
    };
    resolver = { buildEffectiveChain: vi.fn(), selectViableEntry: vi.fn() };
    svc = new ProviderFallbackService(resolver as never, cooldowns as never);
  });

  it('records a cooldown and requeues when a viable next entry remains', async () => {
    resolver.buildEffectiveChain.mockResolvedValue([
      E('a', 'm1'),
      E('b', 'm2'),
    ]);
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(['a']));
    resolver.selectViableEntry.mockReturnValue(E('b', 'm2'));
    const out = await svc.handleFailure({
      message: 'out of extra usage',
      failingProvider: 'a',
      primary: E('a', 'm1'),
      now,
    });
    expect(cooldowns.upsertCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_name: 'a',
        reason: 'usage_exhausted',
      }),
    );
    expect(out).toEqual({ shouldRequeue: true, reason: 'usage_exhausted' });
  });

  it('records a cooldown but does NOT requeue when every entry is now cooled', async () => {
    resolver.buildEffectiveChain.mockResolvedValue([
      E('a', 'm1'),
      E('b', 'm2'),
    ]);
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(['a', 'b']));
    resolver.selectViableEntry.mockReturnValue(null);
    const out = await svc.handleFailure({
      message: 'out of extra usage',
      failingProvider: 'a',
      primary: E('a', 'm1'),
      profileChain: [E('a', 'm1'), E('b', 'm2')],
      now,
    });
    expect(cooldowns.upsertCooldown).toHaveBeenCalled();
    expect(out.shouldRequeue).toBe(false);
  });

  it('does nothing and does not requeue for a non-trigger failure (plain 429)', async () => {
    const out = await svc.handleFailure({
      message: 'HTTP 429 rate limit reached',
      failingProvider: 'a',
      primary: E('a', 'm1'),
      now,
    });
    expect(cooldowns.upsertCooldown).not.toHaveBeenCalled();
    expect(out).toEqual({ shouldRequeue: false, reason: null });
  });
});
