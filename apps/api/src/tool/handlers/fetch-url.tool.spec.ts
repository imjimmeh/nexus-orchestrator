import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import dns from 'node:dns';
import { FetchUrlTool } from './fetch-url.tool';

vi.mock('axios');
vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

const PUBLIC_IP_LOOKUP = { address: '93.184.216.34', family: 4 };

describe('FetchUrlTool', () => {
  let tool: FetchUrlTool;

  beforeEach(() => {
    tool = new FetchUrlTool();
    vi.mocked(dns.promises.lookup).mockResolvedValue({
      address: PUBLIC_IP_LOOKUP.address,
      family: PUBLIC_IP_LOOKUP.family,
    });
  });

  it('exposes the fetch_url tool name', () => {
    expect(tool.getName()).toBe('fetch_url');
  });

  it('returns structured output for a successful HTML fetch', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<html><title>Test Page</title><body><p>Hello world</p></body></html>',
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        url: 'https://example.com',
        timeout_ms: 5000,
      },
    );

    expect(result).toMatchObject({
      url: 'https://example.com',
      title: 'Test Page',
      content: expect.stringContaining('Hello world'),
      content_type: 'text/html',
      status_code: 200,
    });
    expect(result.content).not.toContain('<html>');
  });

  it('returns structured output for a plain-text response', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: 'Just plain text content',
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        url: 'https://example.com/readme.txt',
        timeout_ms: 5000,
      },
    );

    expect(result).toMatchObject({
      url: 'https://example.com/readme.txt',
      title: '',
      content: 'Just plain text content',
      content_type: 'text/plain',
      status_code: 200,
    });
  });

  it('truncates content exceeding MAX_CONTENT_LENGTH', async () => {
    const oversizedBody = 'a'.repeat(150_000);
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: oversizedBody,
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        url: 'https://example.com/large.txt',
        timeout_ms: 5000,
      },
    );

    expect((result.content as string).length).toBe(100_000);
  });

  it('returns a structured error object for non-2xx HTTP responses', async () => {
    const axiosError = Object.assign(new Error('Not Found'), {
      response: { status: 404, statusText: 'Not Found' },
    });
    vi.mocked(axios.get).mockRejectedValue(axiosError);

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        url: 'https://example.com/missing',
        timeout_ms: 5000,
      },
    );

    expect(result).toMatchObject({
      url: 'https://example.com/missing',
      error: 'HTTP 404: Not Found',
      status_code: 404,
    });
  });

  it('re-throws network/timeout errors that have no response', async () => {
    const networkError = Object.assign(new Error('timeout'), {
      code: 'ETIMEDOUT',
    });
    vi.mocked(axios.get).mockRejectedValue(networkError);

    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        { url: 'https://slow.example.com', timeout_ms: 5000 },
      ),
    ).rejects.toThrow('timeout');
  });

  describe('SSRF protection', () => {
    it('blocks requests when hostname resolves to a private IPv4 address', async () => {
      vi.mocked(dns.promises.lookup).mockResolvedValue({
        address: '192.168.1.1',
        family: 4,
      });

      await expect(
        tool.execute(
          { workflowRunId: 'run-1', jobId: 'job-1' },
          { url: 'https://internal.corp', timeout_ms: 5000 },
        ),
      ).rejects.toThrow(/SSRF protection/);
    });

    it('blocks requests to the localhost hostname', async () => {
      // dns.lookup is bypassed for "localhost" before it is called
      await expect(
        tool.execute(
          { workflowRunId: 'run-1', jobId: 'job-1' },
          { url: 'http://localhost/admin', timeout_ms: 5000 },
        ),
      ).rejects.toThrow(/SSRF protection/);
    });

    it('blocks requests to loopback IPv4 literal', async () => {
      await expect(
        tool.execute(
          { workflowRunId: 'run-1', jobId: 'job-1' },
          { url: 'http://127.0.0.1/secret', timeout_ms: 5000 },
        ),
      ).rejects.toThrow(/SSRF protection/);
    });

    it('blocks requests to loopback IPv6 literal ::1', async () => {
      await expect(
        tool.execute(
          { workflowRunId: 'run-1', jobId: 'job-1' },
          { url: 'http://[::1]/secret', timeout_ms: 5000 },
        ),
      ).rejects.toThrow(/SSRF protection/);
    });

    it('allows requests when hostname resolves to a public IP', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        data: 'public content',
      });

      await expect(
        tool.execute(
          { workflowRunId: 'run-1', jobId: 'job-1' },
          { url: 'https://example.com', timeout_ms: 5000 },
        ),
      ).resolves.toMatchObject({ status_code: 200 });
    });
  });
});
