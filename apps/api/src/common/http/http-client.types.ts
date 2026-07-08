/**
 * Shared HTTP client types used by both ACP and MCP transport layers.
 * These types abstract common HTTP request/response handling patterns.
 */

/** Standard timeout configuration for HTTP clients */
export interface HttpTimeoutConfig {
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Connection timeout in milliseconds */
  connectTimeoutMs: number;
}

/** Headers configuration for HTTP requests */
export interface HttpHeadersConfig {
  /** Custom headers to include with every request */
  headers?: Record<string, string> | null;
}

/** Authentication configuration types */
export enum HttpAuthType {
  NONE = 'none',
  BEARER = 'bearer',
  API_KEY = 'api_key',
}

/** Common HTTP client configuration combining all shared settings */
export interface HttpClientConfig extends HttpTimeoutConfig, HttpHeadersConfig {
  baseUrl: string;
  authType: HttpAuthType;
  authToken?: string | null;
}

/** HTTP request options */
export interface HttpRequestOptions {
  /** Request body to serialize as JSON */
  body?: unknown;
  /** Override default timeout for this request */
  timeoutMs?: number;
}

/** Result of reading an error response body */
export interface HttpErrorBody {
  /** Whether the body was successfully parsed as JSON */
  isJson: boolean;
  /** The parsed JSON object, or raw text if not JSON */
  data: unknown;
}

/** HTTP response with parsed body */
export interface HttpResponse<T> {
  status: number;
  body: T;
  headers?: Headers;
}
