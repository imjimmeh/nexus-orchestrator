export type JsonHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ServiceClientHttpOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  authorizationHeaderResolver?: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
}

export interface JsonHttpRequest {
  path: string;
  method: JsonHttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
}
