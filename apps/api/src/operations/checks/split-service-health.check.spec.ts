import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitServiceHealthCheckService } from './split-service-health.check';

describe('SplitServiceHealthCheckService', () => {
  const previousChatBaseUrl = process.env.CHAT_SERVICE_BASE_URL;
  const previousTimeout = process.env.DOCTOR_SPLIT_SERVICE_TIMEOUT_MS;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAT_SERVICE_BASE_URL = 'http://chat.internal:3013/api';
    process.env.DOCTOR_SPLIT_SERVICE_TIMEOUT_MS = '1000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.CHAT_SERVICE_BASE_URL = previousChatBaseUrl;
    process.env.DOCTOR_SPLIT_SERVICE_TIMEOUT_MS = previousTimeout;
  });

  it('returns ok when all configured split services are healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<
          (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        >()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: 'ok',
            }),
            {
              status: 200,
            },
          ),
        ),
    );

    const service = new SplitServiceHealthCheckService();
    const result = await service.run();

    expect(result.status).toBe('ok');
    expect(result.evidence.summary).toContain('passed');
  });

  it('returns warn when a configured split service is unreachable', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = toUrl(input);
        if (url.includes('chat.internal')) {
          throw new Error('connect ECONNREFUSED');
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SplitServiceHealthCheckService();
    const result = await service.run();

    expect(result.status).toBe('warn');
    expect(result.evidence.summary).toContain('warning');
  });

  it('returns fail when a split service reports non-ok health status', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = toUrl(input);
        if (url.includes('chat.internal')) {
          return new Response(JSON.stringify({ status: 'degraded' }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SplitServiceHealthCheckService();
    const result = await service.run();

    expect(result.status).toBe('fail');
    expect(result.evidence.summary).toContain('failed');
  });
});

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}
