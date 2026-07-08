import axios from 'axios';
import dns from 'node:dns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebFetchTool } from './web-fetch.tool';

vi.mock('axios');
vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
    vi.mocked(dns.promises.lookup).mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('exposes the governed web_fetch tool definition', () => {
    const definition = tool.getDefinition();

    expect(tool.getName()).toBe('web_fetch');
    expect(definition.transport).toBe('api_callback');
    expect(definition.runtimeOwner).toBe('api');
    expect(definition.policyTags).toEqual(['read_only', 'web', 'fetch']);
  });

  it('returns bounded text with final URL metadata for HTML responses', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: '<html><title>Docs</title><body><main>Hello <strong>docs</strong></main></body></html>',
      request: { res: { responseUrl: 'https://docs.example.com/final' } },
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        url: 'https://docs.example.com/start',
        format: 'text',
        max_bytes: 12,
        timeout_ms: 5000,
      },
    );

    expect(result).toMatchObject({
      url: 'https://docs.example.com/start',
      final_url: 'https://docs.example.com/final',
      status: 200,
      content_type: 'text/html; charset=utf-8',
      title: 'Docs',
      content: expect.any(String),
      truncated: true,
      warnings: ['content_truncated'],
    });
    expect(result.content as string).toHaveLength(12);
  });

  it('blocks localhost and private network targets', async () => {
    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        {
          url: 'http://127.0.0.1/private',
          format: 'text',
          max_bytes: 1000,
          timeout_ms: 5000,
        },
      ),
    ).rejects.toThrow(/SSRF protection/);
  });
});
