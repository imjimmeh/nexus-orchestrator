/**
 * Shared HTTP client utilities for ACP and MCP transport layers.
 * These utilities handle common patterns: timeout, auth, error parsing, response parsing.
 */

import type { HttpErrorBody } from './http-client.types';
import { HttpAuthType } from './http-client.types';

// Re-export types for convenience
export type {
  HttpClientConfig,
  HttpRequestOptions,
  HttpErrorBody,
  HttpTimeoutConfig,
  HttpHeadersConfig,
} from './http-client.types';
export { HttpAuthType };

/**
 * Maps protocol-specific auth types to the common HttpAuthType enum.
 * Used when the protocol has its own auth type enum.
 */
export function mapAuthType(
  authType: string,
  authTypeMap: Record<string, HttpAuthType>,
): HttpAuthType {
  return authTypeMap[authType] ?? HttpAuthType.NONE;
}

/**
 * Applies authentication headers based on auth configuration.
 * Supports Bearer tokens, API keys, and no auth.
 */
export function applyAuthHeaders(
  headers: Record<string, string>,
  authType: HttpAuthType,
  authToken?: string | null,
): void {
  if (authType === HttpAuthType.BEARER && authToken) {
    headers['authorization'] = `Bearer ${authToken}`;
    return;
  }

  if (authType === HttpAuthType.API_KEY && authToken) {
    headers['x-api-key'] = authToken;
  }
  // NONE: do nothing
}

/**
 * Reads and parses the error response body.
 * Attempts to parse as JSON first, falls back to raw text.
 */
export async function parseErrorBody(
  response: Response,
): Promise<HttpErrorBody> {
  try {
    const data = (await response.json()) as unknown;
    return { isJson: true, data };
  } catch {
    const text = await response.text();
    return { isJson: false, data: text };
  }
}

/**
 * Parses the response body text into JSON.
 * Returns empty object for empty responses.
 */
export async function parseResponseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Creates an abort controller with a timeout.
 * Returns a cleanup function that must be called to clear the timer.
 */
export function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    cleanup: () => {
      clearTimeout(timeoutId);
    },
  };
}

/**
 * Builds a timeout signal for fetch requests.
 * Returns the signal along with a cleanup function.
 */
export function getTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const { controller, cleanup } = createTimeoutController(timeoutMs);
  return { signal: controller.signal, cleanup };
}

/**
 * Executes an HTTP request with timeout handling.
 * Applies auth headers and parses the response.
 */
export async function executeHttpRequest<T>(config: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  authType?: HttpAuthType;
  authToken?: string | null;
  headersConfig?: Record<string, string>;
  onError?: (status: number, body: HttpErrorBody) => Error;
}): Promise<T> {
  const {
    method,
    url,
    headers: additionalHeaders,
    body,
    timeoutMs,
    authType,
    authToken,
    headersConfig,
    onError,
  } = config;

  const { signal, cleanup } = getTimeoutSignal(timeoutMs);

  const headers: Record<string, string> = {
    ...(headersConfig ?? {}),
    ...(additionalHeaders ?? {}),
  };

  if (authType !== undefined && authToken !== undefined) {
    applyAuthHeaders(headers, authType, authToken);
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      if (onError) {
        throw onError(response.status, errorBody);
      }
      throw new Error(
        `HTTP request failed with status ${response.status}: ${JSON.stringify(errorBody.data)}`,
      );
    }

    return await parseResponseBody<T>(response);
  } finally {
    cleanup();
  }
}

/**
 * Builds URL with query parameters.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined | null>,
): string {
  const url = `${baseUrl}${path}`;
  if (!params || Object.keys(params).length === 0) {
    return url;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
}

/**
 * Default error handler for HTTP requests.
 * Creates a descriptive error message from status and body.
 */
export function createHttpError(
  protocol: string,
  status: number,
  body: HttpErrorBody,
): Error {
  return new Error(
    `${protocol} HTTP request failed with status ${status}: ${JSON.stringify(body.data)}`,
  );
}
