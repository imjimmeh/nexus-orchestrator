import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import type { WebSearchInput } from '../../../../../packages/core/dist/schemas/web';
import { webSearchInputSchema } from '../../../../../packages/core/dist/schemas/web';

const WEB_SEARCH_TIMEOUT_MS = 10_000;

type SearxngResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  publishedDate?: unknown;
};

type SearxngResponse = {
  results?: SearxngResult[];
};

@Injectable()
export class WebSearchTool implements IInternalToolHandler<WebSearchInput> {
  getName(): string {
    return 'web_search';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'web', 'search'],
      description:
        'Search the public web through the configured governed search provider.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: {
          query: 'query',
          max_results: 'max_results',
          site: 'site',
          freshness: 'freshness',
          safe_search: 'safe_search',
        },
      },
      inputSchema: webSearchInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: WebSearchInput,
  ): Promise<Record<string, unknown>> {
    const endpoint = process.env.WEB_SEARCH_ENDPOINT?.trim();
    if (!endpoint) {
      throw new Error(
        'WEB_SEARCH_ENDPOINT must be configured before using web_search',
      );
    }

    const query = params.site
      ? `site:${params.site} ${params.query}`
      : params.query;
    const response = await axios.get<SearxngResponse>(endpoint, {
      timeout: WEB_SEARCH_TIMEOUT_MS,
      params: {
        q: query,
        format: 'json',
        safesearch: this.toSearxngSafeSearch(params.safe_search),
        time_range: params.freshness === 'any' ? undefined : params.freshness,
      },
    });

    const results = (response.data.results ?? [])
      .filter(
        (entry) =>
          typeof entry.title === 'string' && typeof entry.url === 'string',
      )
      .slice(0, params.max_results)
      .map((entry) => ({
        title: entry.title as string,
        url: entry.url as string,
        snippet: typeof entry.content === 'string' ? entry.content : '',
        ...(typeof entry.publishedDate === 'string'
          ? { published_at: entry.publishedDate }
          : {}),
      }));

    return {
      query: params.query,
      provider: process.env.WEB_SEARCH_PROVIDER_NAME?.trim() || 'searxng',
      results,
      warnings: results.length === 0 ? ['no_results'] : [],
    };
  }

  private toSearxngSafeSearch(value: WebSearchInput['safe_search']): 0 | 1 | 2 {
    if (value === 'off') {
      return 0;
    }

    if (value === 'strict') {
      return 2;
    }

    return 1;
  }
}
