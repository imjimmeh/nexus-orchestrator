import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FallbackChainResolverService } from './fallback-chain-resolver.service';

const E = (provider_name: string, model_name: string) => ({
  provider_name,
  model_name,
});

describe('FallbackChainResolverService.selectViableEntry', () => {
  const svc = new FallbackChainResolverService({} as never, {} as never);
  const chain = [E('a', 'm1'), E('b', 'm2'), E('c', 'm3')];

  it('returns the first entry when none are cooled', () => {
    expect(svc.selectViableEntry(chain, new Set())).toEqual(E('a', 'm1'));
  });
  it('skips a cooled provider and returns the next viable entry', () => {
    expect(svc.selectViableEntry(chain, new Set(['a']))).toEqual(E('b', 'm2'));
  });
  it('returns null when every entry is cooled', () => {
    expect(svc.selectViableEntry(chain, new Set(['a', 'b', 'c']))).toBeNull();
  });
});

describe('FallbackChainResolverService.resolve', () => {
  let chains: { findByName: ReturnType<typeof vi.fn> };
  let cooldowns: { findActiveProviderNames: ReturnType<typeof vi.fn> };
  let svc: FallbackChainResolverService;
  beforeEach(() => {
    chains = { findByName: vi.fn().mockResolvedValue(null) };
    cooldowns = {
      findActiveProviderNames: vi.fn().mockResolvedValue(new Set<string>()),
    };
    svc = new FallbackChainResolverService(chains as never, cooldowns as never);
  });

  it('returns the primary unchanged when no chain is configured', async () => {
    const out = await svc.resolve({ primary: E('a', 'm1') }, new Date());
    expect(out).toEqual(E('a', 'm1'));
  });

  it('prefers the profile chain over the global default and skips cooled providers', async () => {
    chains.findByName.mockResolvedValue({
      name: 'default',
      entries: [E('z', 'mz')],
    });
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(['a']));
    const out = await svc.resolve(
      { primary: E('a', 'm1'), profileChain: [E('a', 'm1'), E('b', 'm2')] },
      new Date(),
    );
    expect(out).toEqual(E('b', 'm2'));
  });

  it('falls back to the primary (best-effort) when all entries are cooled', async () => {
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(['a', 'b']));
    const out = await svc.resolve(
      { primary: E('a', 'm1'), profileChain: [E('a', 'm1'), E('b', 'm2')] },
      new Date(),
    );
    expect(out).toEqual(E('a', 'm1'));
  });
});
