import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { fetchRawWebContent } from './safe-web-fetch.helpers';

vi.mock('axios');

describe('fetchRawWebContent', () => {
  it('preserves redirect metadata when fetching web content', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: '<html><title>Redirected</title><body>content</body></html>',
      request: { res: { responseUrl: 'https://example.com/final' } },
    });

    await expect(
      fetchRawWebContent('https://example.com/start', 5000),
    ).resolves.toEqual({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><title>Redirected</title><body>content</body></html>',
      finalUrl: 'https://example.com/final',
    });
  });
});
