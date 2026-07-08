export const HTTP_JSON_CLIENT = Symbol('HTTP_JSON_CLIENT');

export type HttpMethod = 'GET' | 'POST' | 'PUT';
export type TokenScheme = 'bearer' | 'private-token' | 'basic-token';

export interface HttpJsonRequest {
  method: HttpMethod;
  url: string;
  token: string;
  tokenScheme?: TokenScheme;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpJsonResponse<T = unknown> {
  status: number;
  data: T;
}

export interface HttpJsonClient {
  request<T = unknown>(args: HttpJsonRequest): Promise<HttpJsonResponse<T>>;
}
