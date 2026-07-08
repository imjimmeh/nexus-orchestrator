import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchHarnessHttpClient } from './fetch-harness-http-client';

describe('FetchHarnessHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to global fetch and maps the response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        capabilities: { toolModel: 'permission_callback' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchHarnessHttpClient();
    const res = await client.get('https://example.test/health', {
      timeoutMs: 1000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      capabilities: { toolModel: 'permission_callback' },
    });
  });

  it('returns ok:false when fetch rejects (unreachable)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FetchHarnessHttpClient();
    const res = await client.get('https://down.test/health');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});
