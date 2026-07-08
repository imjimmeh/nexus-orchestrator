import { describe, expect, it, vi } from 'vitest';
import { ContainerHttpClientService } from '../docker/container-http-client.service';
import { ServiceMeshHeaderIpResolver } from './service-mesh-header-ip-resolver';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

type RawResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function makeHttpClient() {
  return {
    httpGetRaw: vi.fn<
      [string, { timeoutMs?: number }?],
      Promise<RawResponse>
    >(),
  } as unknown as ContainerHttpClientService & {
    httpGetRaw: ReturnType<typeof vi.fn>;
  };
}

describe('ServiceMeshHeaderIpResolver', () => {
  it('returns the IP from the X-Orchestrator-Ip response header on success', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': '10.0.0.42' },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('10.0.0.42');
    expect(httpClient.httpGetRaw).toHaveBeenCalledWith(
      'http://orchestrator.local:3010/healthz',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('strips surrounding brackets from a bracketed full-form IPv6 header value', async () => {
    // The service-mesh resolver deliberately rejects shorthand IPv6
    // (`::1`) per its source contract — it expects the canonical
    // eight-group form. Use a full-form literal here.
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: {
        'x-orchestrator-ip': '[2001:0db8:0000:0000:0000:0000:0000:0001]',
      },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('rejects shorthand IPv6 literals in the X-Orchestrator-Ip header', async () => {
    // The service-mesh resolver expects canonical eight-group IPv6;
    // shorthand `::` notation surfaces as a typed error rather than
    // risk a malformed IP reaching buildBaseUrl.
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': '::1' },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/invalid IP literal/);
  });

  it('trims whitespace from the IP header value before validating', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': '  10.0.0.42  ' },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('10.0.0.42');
  });

  it('accepts an array-valued header and uses the first string entry', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': ['10.0.0.42', '10.0.0.43'] },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('10.0.0.42');
  });

  it('throws when the response is missing the X-Orchestrator-Ip header', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/missing required 'X-Orchestrator-Ip'/);
  });

  it('throws when the header value is not a valid IPv4 or full-form IPv6 literal', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': 'not-an-ip' },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/invalid IP literal/);
  });

  it('throws when the sentinel returns a non-200 status code', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 503,
      headers: { 'x-orchestrator-ip': '10.0.0.42' },
      body: 'overloaded',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/returned status 503/);
  });

  it('wraps HTTP-layer failures (timeout, refused) in an OrchestratorIpResolutionError', async () => {
    const httpClient = makeHttpClient();
    const timeoutError = new Error('timeout of 2000ms exceeded');
    httpClient.httpGetRaw.mockRejectedValue(timeoutError);
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/Sentinel GET .* failed: timeout of 2000ms exceeded/);
  });

  it('uses a 2s timeout on the sentinel HTTP request', async () => {
    const httpClient = makeHttpClient();
    httpClient.httpGetRaw.mockResolvedValue({
      statusCode: 200,
      headers: { 'x-orchestrator-ip': '10.0.0.42' },
      body: 'ok',
    });
    const resolver = new ServiceMeshHeaderIpResolver(httpClient);

    await resolver.resolve('http://orchestrator.local:3010');

    expect(httpClient.httpGetRaw).toHaveBeenCalledWith(
      'http://orchestrator.local:3010/healthz',
      { timeoutMs: 2000 },
    );
  });

  it('accepts an optional SystemSettingsService constructor argument (no-op today)', () => {
    const httpClient = makeHttpClient();
    // The constructor accepts an optional SystemSettingsService but
    // does not consume it; this test pins the constructor signature so
    // a future change cannot silently break the DI wiring.
    expect(
      () => new ServiceMeshHeaderIpResolver(httpClient, undefined),
    ).not.toThrow();
  });
});
