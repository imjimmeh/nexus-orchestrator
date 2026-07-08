import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import type { WebFetchInput } from '../../../../../packages/core/dist/schemas/web';
import { webFetchInputSchema } from '../../../../../packages/core/dist/schemas/web';
import {
  assertNotPrivateHost,
  extractTitle,
  fetchRawWebContent,
  stripHtml,
} from './safe-web-fetch.helpers';

@Injectable()
export class WebFetchTool implements IInternalToolHandler<WebFetchInput> {
  getName(): string {
    return 'web_fetch';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'web', 'fetch'],
      description:
        'Fetch a public web URL and return bounded text with source metadata.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: {
          url: 'url',
          format: 'format',
          max_bytes: 'max_bytes',
          timeout_ms: 'timeout_ms',
        },
      },
      inputSchema: webFetchInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: WebFetchInput,
  ): Promise<Record<string, unknown>> {
    await assertNotPrivateHost(params.url);

    try {
      const raw = await fetchRawWebContent(params.url, params.timeout_ms);
      const readableContent = raw.contentType.includes('text/html')
        ? stripHtml(raw.body)
        : raw.body;
      const content = readableContent.slice(0, params.max_bytes);
      const truncated = readableContent.length > params.max_bytes;

      return {
        url: params.url,
        final_url: raw.finalUrl,
        status: raw.status,
        content_type: raw.contentType,
        title: raw.contentType.includes('text/html')
          ? extractTitle(raw.body)
          : '',
        content,
        truncated,
        warnings: truncated ? ['content_truncated'] : [],
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return {
          url: params.url,
          final_url: params.url,
          status: axiosError.response.status,
          content_type:
            typeof axiosError.response.headers?.['content-type'] === 'string'
              ? axiosError.response.headers['content-type']
              : '',
          title: '',
          content: '',
          truncated: false,
          warnings: [
            `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`,
          ],
        };
      }

      throw error;
    }
  }
}
