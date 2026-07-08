import {
  AcpAgentManifest,
  AcpEvent,
  AcpRun,
  AcpRunCreateRequest,
  AcpRunResumeRequest,
  AcpSession,
} from '@nexus/core';
import {
  applyAuthHeaders,
  buildUrl,
  createHttpError,
  createTimeoutController,
  executeHttpRequest,
  mapAuthType,
  parseErrorBody,
  HttpAuthType,
} from '../common/http/http-client.utils';
import {
  AcpAuthType,
  type AcpHttpClientConfig,
  type ListAgentsResult,
} from './acp-http-client.types';

// Re-export for external consumers
export { AcpAuthType } from './acp-http-client.types';
export {
  type AcpHttpClientConfig,
  type ListAgentsResult,
} from './acp-http-client.types';

/**
 * Maps ACP auth type to the common HttpAuthType enum.
 */
const ACP_AUTH_TYPE_MAP: Record<AcpAuthType, HttpAuthType> = {
  [AcpAuthType.BEARER]: HttpAuthType.BEARER,
  [AcpAuthType.API_KEY]: HttpAuthType.API_KEY,
  [AcpAuthType.NONE]: HttpAuthType.NONE,
};

export class AcpHttpClient {
  constructor(private readonly config: AcpHttpClientConfig) {}

  async ping(): Promise<void> {
    await executeHttpRequest<Record<string, never>>({
      method: 'GET',
      url: buildUrl(this.config.baseUrl, '/ping'),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async listAgents(limit?: number, offset?: number): Promise<ListAgentsResult> {
    const params: Record<string, string | number | undefined> = {};
    if (limit !== undefined) params['limit'] = limit;
    if (offset !== undefined) params['offset'] = offset;

    return executeHttpRequest<ListAgentsResult>({
      method: 'GET',
      url: buildUrl(this.config.baseUrl, '/agents', params),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async getAgent(name: string): Promise<AcpAgentManifest> {
    return executeHttpRequest<AcpAgentManifest>({
      method: 'GET',
      url: buildUrl(this.config.baseUrl, `/agents/${encodeURIComponent(name)}`),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async createRun(req: AcpRunCreateRequest): Promise<AcpRun> {
    return executeHttpRequest<AcpRun>({
      method: 'POST',
      url: buildUrl(this.config.baseUrl, '/runs'),
      body: req,
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async createRunStreaming(
    req: AcpRunCreateRequest,
  ): Promise<AsyncIterable<AcpEvent>> {
    const url = buildUrl(this.config.baseUrl, '/runs');

    // Apply auth headers to custom headers
    const authHeaders: Record<string, string> = {};
    applyAuthHeaders(
      authHeaders,
      mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      this.config.authToken,
    );

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(this.config.headers ?? {}),
      ...authHeaders,
    };

    const { controller, cleanup } = createTimeoutController(
      this.config.timeoutMs,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    cleanup();

    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      throw createHttpError('ACP', response.status, errorBody);
    }

    if (!response.body) {
      throw new Error('ACP HTTP streaming response has no body');
    }

    return parseSseStream(response.body);
  }

  async getRun(runId: string): Promise<AcpRun> {
    return executeHttpRequest<AcpRun>({
      method: 'GET',
      url: buildUrl(this.config.baseUrl, `/runs/${encodeURIComponent(runId)}`),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async resumeRun(runId: string, req: AcpRunResumeRequest): Promise<AcpRun> {
    return executeHttpRequest<AcpRun>({
      method: 'POST',
      url: buildUrl(this.config.baseUrl, `/runs/${encodeURIComponent(runId)}`),
      body: req,
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async cancelRun(runId: string): Promise<AcpRun> {
    return executeHttpRequest<AcpRun>({
      method: 'POST',
      url: buildUrl(
        this.config.baseUrl,
        `/runs/${encodeURIComponent(runId)}/cancel`,
      ),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async listRunEvents(runId: string): Promise<AcpEvent[]> {
    return executeHttpRequest<AcpEvent[]>({
      method: 'GET',
      url: buildUrl(
        this.config.baseUrl,
        `/runs/${encodeURIComponent(runId)}/events`,
      ),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }

  async getSession(sessionId: string): Promise<AcpSession> {
    return executeHttpRequest<AcpSession>({
      method: 'GET',
      url: buildUrl(
        this.config.baseUrl,
        `/session/${encodeURIComponent(sessionId)}`,
      ),
      timeoutMs: this.config.timeoutMs,
      authType: mapAuthType(this.config.authType, ACP_AUTH_TYPE_MAP),
      authToken: this.config.authToken,
      headersConfig: this.config.headers ?? undefined,
    });
  }
}

/**
 * Parses a Server-Sent Events (SSE) stream from a ReadableStream.
 * Handles SSE data lines and the [DONE] sentinel.
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterableIterator<AcpEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            const event = JSON.parse(data) as AcpEvent;
            yield event;
          } catch {
            // Skip invalid JSON in SSE data
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
