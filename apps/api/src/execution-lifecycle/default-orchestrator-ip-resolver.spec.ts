import { describe, expect, it } from 'vitest';
import { DefaultOrchestratorIpResolver } from './default-orchestrator-ip-resolver';

describe('DefaultOrchestratorIpResolver', () => {
  const resolver = new DefaultOrchestratorIpResolver();

  it('returns the hostname for an http URL with a port', async () => {
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('orchestrator.local');
  });

  it('returns the hostname for an https URL with a path, query, and fragment', async () => {
    await expect(
      resolver.resolve('https://orchestrator.local:443/foo?bar=1#baz'),
    ).resolves.toBe('orchestrator.local');
  });

  it('returns the literal IP for an http URL whose host is an IPv4 address', async () => {
    await expect(resolver.resolve('http://10.0.0.1:3010')).resolves.toBe(
      '10.0.0.1',
    );
  });

  it('returns the bracketed IPv6 hostname as-is from the WHATWG parser', async () => {
    // The default resolver returns the URL's hostname verbatim (no
    // bracket stripping). Bracket stripping is the responsibility of
    // the strategy resolvers that consume the value as an IP literal
    // (dns_round_robin / service_mesh_header / custom_http_endpoint).
    await expect(resolver.resolve('http://[::1]:3010')).resolves.toBe('[::1]');
  });

  it('rejects an obviously malformed URL via a synchronous TypeError', () => {
    // `new URL(...)` throws synchronously when the WHATWG parser cannot
    // parse the input; the function therefore throws before returning a
    // Promise, so we use a synchronous `.toThrow()` assertion.
    expect(() => resolver.resolve('not a url at all')).toThrow(TypeError);
  });

  it('rejects an empty string via a synchronous TypeError', () => {
    expect(() => resolver.resolve('')).toThrow(TypeError);
  });
});
