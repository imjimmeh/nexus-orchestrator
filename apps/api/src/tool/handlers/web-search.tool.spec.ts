import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { WebSearchTool } from './web-search.tool';

vi.mock('axios');

describe('WebSearchTool', () => {
  const originalEnv = process.env;
  let tool: WebSearchTool;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      WEB_SEARCH_ENDPOINT: 'https://search.example.com/search',
    };
    tool = new WebSearchTool();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('exposes the web_search tool definition', () => {
    const definition = tool.getDefinition();

    expect(tool.getName()).toBe('web_search');
    expect(definition.transport).toBe('api_callback');
    expect(definition.runtimeOwner).toBe('api');
    expect(definition.policyTags).toEqual(['read_only', 'web', 'search']);
  });

  it('returns bounded normalized search results from a SearXNG-compatible response', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        results: [
          {
            title: 'Docs',
            url: 'https://docs.example.com',
            content: 'Official docs snippet',
            publishedDate: '2026-07-07T12:00:00.000Z',
          },
          {
            title: 'Blog',
            url: 'https://blog.example.com',
            content: 'Blog snippet',
          },
        ],
      },
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        query: 'nexus orchestrator docs',
        site: 'docs.example.com',
        max_results: 1,
        freshness: 'any',
        safe_search: 'moderate',
      },
    );

    expect(axios.get).toHaveBeenCalledWith(
      'https://search.example.com/search',
      expect.objectContaining({
        timeout: 10000,
        params: expect.objectContaining({
          q: 'site:docs.example.com nexus orchestrator docs',
          format: 'json',
          safesearch: 1,
        }),
      }),
    );

    expect(result).toEqual({
      query: 'nexus orchestrator docs',
      provider: 'searxng',
      results: [
        {
          title: 'Docs',
          url: 'https://docs.example.com',
          snippet: 'Official docs snippet',
          published_at: '2026-07-07T12:00:00.000Z',
        },
      ],
      warnings: [],
    });
  });

  it('fails clearly when no search endpoint is configured', async () => {
    process.env = { ...originalEnv, WEB_SEARCH_ENDPOINT: '' };
    tool = new WebSearchTool();

    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        {
          query: 'docs',
          max_results: 5,
          freshness: 'any',
          safe_search: 'moderate',
        },
      ),
    ).rejects.toThrow(/WEB_SEARCH_ENDPOINT/);
  });
});
