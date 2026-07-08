import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import {
  assertNotPrivateHost,
  extractTitle,
  fetchRawWebContent,
  stripHtml,
} from './safe-web-fetch.helpers';

const MAX_CONTENT_LENGTH = 100_000;

const fetchUrlInputSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().int().positive().optional().default(10_000),
});

type FetchUrlInput = z.infer<typeof fetchUrlInputSchema>;

@Injectable()
export class FetchUrlTool implements IInternalToolHandler<FetchUrlInput> {
  getName(): string {
    return 'fetch_url';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'ingestion', 'fetch'],
      description:
        'Fetch URL content, extract readable text from HTML, and return structured output.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { url: 'url', timeout_ms: 'timeout_ms' },
      },
      inputSchema: fetchUrlInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: FetchUrlInput,
  ): Promise<Record<string, unknown>> {
    await assertNotPrivateHost(params.url);

    try {
      const raw = await fetchRawWebContent(params.url, params.timeout_ms);
      const isHtml = raw.contentType.includes('text/html');
      const content = isHtml ? stripHtml(raw.body) : raw.body;
      const title = isHtml ? extractTitle(raw.body) : '';

      return {
        url: params.url,
        title,
        content: content.slice(0, MAX_CONTENT_LENGTH),
        content_type: raw.contentType,
        status_code: raw.status,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return {
          url: params.url,
          error: `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`,
          status_code: axiosError.response.status,
        };
      }
      throw error;
    }
  }
}
