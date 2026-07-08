import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { DnsRoundRobinIpResolver } from './dns-round-robin-ip-resolver';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);

afterEach(() => {
  vi.clearAllMocks();
});

describe('DnsRoundRobinIpResolver', () => {
  it('returns the only IP when the DNS lookup returns a single A record', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    const resolver = new DnsRoundRobinIpResolver();

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('10.0.0.1');
    expect(lookupMock).toHaveBeenCalledWith(
      'orchestrator.local',
      expect.objectContaining({ all: true, verbatim: true }),
    );
  });

  it('returns one of the IPs when the DNS lookup returns multiple records', async () => {
    lookupMock.mockResolvedValue([
      { address: '10.0.0.1', family: 4 },
      { address: '10.0.0.2', family: 4 },
      { address: '10.0.0.3', family: 4 },
    ] as never);
    const resolver = new DnsRoundRobinIpResolver();

    const result = await resolver.resolve('http://orchestrator.local:3010');

    expect(['10.0.0.1', '10.0.0.2', '10.0.0.3']).toContain(result);
    // At most one lookup — the sticky cache may skip the second lookup
    // depending on the random pick, so we only assert that the
    // first call did hit the DNS resolver.
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('sticks to the chosen IP across subsequent calls within the TTL window', async () => {
    lookupMock.mockResolvedValue([
      { address: '10.0.0.1', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ] as never);
    const resolver = new DnsRoundRobinIpResolver();

    const first = await resolver.resolve('http://orchestrator.local:3010');
    const second = await resolver.resolve('http://orchestrator.local:3010');
    const third = await resolver.resolve('http://orchestrator.local:3010');

    expect(second).toBe(first);
    expect(third).toBe(first);
    // The sticky cache means the DNS lookup should only have been
    // performed once across the three resolve() calls.
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('throws OrchestratorIpResolutionError when no records are returned', async () => {
    // The `all: true` overload returns an array; passing an empty
    // array exercises the "no records" branch.
    lookupMock.mockResolvedValue([] as never);
    const resolver = new DnsRoundRobinIpResolver();

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/no A\/AAAA records/);
  });

  it('wraps DNS-layer failures in an OrchestratorIpResolutionError', async () => {
    const dnsError = new Error('ENOTFOUND');
    lookupMock.mockRejectedValue(dnsError);
    const resolver = new DnsRoundRobinIpResolver();

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/DNS lookup failed/);
  });

  it('propagates WHATWG URL parse failures as rejections (no DNS lookup attempted)', async () => {
    const resolver = new DnsRoundRobinIpResolver();

    // Malformed URLs are rejected by the WHATWG parser before the
    // resolver can attempt a DNS lookup. The DNS layer is never
    // reached on this path.
    await expect(resolver.resolve('not a url')).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('strips IPv6 brackets from the parsed hostname before performing DNS lookup', async () => {
    lookupMock.mockResolvedValue([{ address: '::1', family: 6 }] as never);
    const resolver = new DnsRoundRobinIpResolver();

    await expect(resolver.resolve('http://[::1]:3010')).resolves.toBe('::1');
    expect(lookupMock).toHaveBeenCalledWith(
      '::1',
      expect.objectContaining({ all: true, verbatim: true }),
    );
  });

  it('accepts an optional SystemSettingsService constructor argument (no-op today)', () => {
    // The constructor accepts an optional SystemSettingsService but
    // does not consume it; this test pins the constructor signature so
    // a future change cannot silently break the DI wiring.
    expect(() => new DnsRoundRobinIpResolver(undefined)).not.toThrow();
  });
});
