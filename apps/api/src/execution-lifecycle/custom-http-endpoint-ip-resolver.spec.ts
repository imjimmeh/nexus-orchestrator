import { describe, expect, it, vi } from 'vitest';
import { ContainerHttpClientService } from '../docker/container-http-client.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { CustomHttpEndpointIpResolver } from './custom-http-endpoint-ip-resolver';
import { EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING } from './execution-dispatch.settings';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

type RawResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function makeDeps(overrides?: {
  settingsValue?: unknown;
  rawResponse?: RawResponse;
  rawError?: Error;
}) {
  const httpClient = {
    httpGetRaw: vi.fn<
      [string, { timeoutMs?: number }?],
      Promise<RawResponse>
    >(),
  } as unknown as ContainerHttpClientService & {
    httpGetRaw: ReturnType<typeof vi.fn>;
  };
  if (overrides?.rawResponse) {
    httpClient.httpGetRaw.mockResolvedValue(overrides.rawResponse);
  }
  if (overrides?.rawError) {
    httpClient.httpGetRaw.mockRejectedValue(overrides.rawError);
  }
  const get = vi
    .fn<[string, string | null], Promise<unknown>>()
    .mockImplementation(async (_key, defaultValue) => {
      if (overrides?.settingsValue === undefined) {
        return defaultValue;
      }
      return overrides.settingsValue;
    });
  const settings = { get } as unknown as SystemSettingsService & {
    get: ReturnType<typeof vi.fn>;
  };
  return { httpClient, settings, get };
}

describe('CustomHttpEndpointIpResolver', () => {
  it('reads the endpoint setting and returns the parsed ip field on success', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: '172.16.5.12' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('172.16.5.12');

    expect(deps.get).toHaveBeenCalledWith(
      EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING,
      null,
    );
    expect(deps.httpClient.httpGetRaw).toHaveBeenCalledWith(
      'https://ip-allocator.internal/orchestrator',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('strips surrounding brackets from a bracketed full-form IPv6 ip field', async () => {
    // The custom-endpoint resolver deliberately rejects shorthand IPv6
    // per its source contract — it expects the canonical eight-group
    // form. Use a full-form literal here.
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({
          ip: '[2001:0db8:0000:0000:0000:0000:0000:0001]',
        }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).resolves.toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('rejects shorthand IPv6 literals in the ip field', async () => {
    // The custom-endpoint resolver expects canonical eight-group IPv6;
    // shorthand `::` notation surfaces as a typed error rather than
    // risk a malformed IP reaching buildBaseUrl.
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ip: '::1' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/invalid IP literal/);
  });

  it('throws when the endpoint setting is unset', async () => {
    const deps = makeDeps({}); // no settingsValue → get() returns the default (null)
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/must be configured/);
    expect(deps.httpClient.httpGetRaw).not.toHaveBeenCalled();
  });

  it('throws when the endpoint setting is an empty string', async () => {
    const deps = makeDeps({ settingsValue: '   ' });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/must be configured/);
  });

  it('throws when the endpoint setting is a malformed URL', async () => {
    const deps = makeDeps({ settingsValue: 'not a url' });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/must be configured/);
  });

  it('throws when the response body is not valid JSON', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: 'not json at all',
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/non-JSON body/);
  });

  it('throws when the JSON does not contain a non-empty ip field', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ foo: 'bar' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/non-empty 'ip' string field/);
  });

  it('throws when the ip field is an empty string', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ip: '' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/non-empty 'ip' string field/);
  });

  it('throws when the ip field is not a valid IP literal', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ip: 'not-an-ip' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/invalid IP literal/);
  });

  it('throws on a non-200 HTTP response from the endpoint', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 500,
        headers: {},
        body: 'oops',
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/returned status 500/);
  });

  it('wraps connection-layer errors in an OrchestratorIpResolutionError', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawError: new Error('ECONNREFUSED'),
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toBeInstanceOf(OrchestratorIpResolutionError);
    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('truncates long non-JSON response bodies in the surfaced error message', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: '<html>' + 'x'.repeat(500) + '</html>',
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await expect(
      resolver.resolve('http://orchestrator.local:3010'),
    ).rejects.toThrow(/truncated/);
  });

  it('uses a 2s timeout on the endpoint HTTP request', async () => {
    const deps = makeDeps({
      settingsValue: 'https://ip-allocator.internal/orchestrator',
      rawResponse: {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ip: '172.16.5.12' }),
      },
    });
    const resolver = new CustomHttpEndpointIpResolver(
      deps.httpClient,
      deps.settings,
    );

    await resolver.resolve('http://orchestrator.local:3010');

    expect(deps.httpClient.httpGetRaw).toHaveBeenCalledWith(
      'https://ip-allocator.internal/orchestrator',
      { timeoutMs: 2000 },
    );
  });
});
