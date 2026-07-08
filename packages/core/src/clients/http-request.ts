import type {
  JsonHttpRequest,
  ServiceClientHttpOptions,
} from "./http-client.types";
import { retryWithBackoff } from "../utils/retry-with-backoff";

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const HTTP_REQUEST_MAX_ATTEMPTS = 6;
const HTTP_REQUEST_RETRY_BASE_MS = 500;
const HTTP_REQUEST_RETRY_MAX_MS = 8_000;
const HTTP_REQUEST_RETRIABLE_STATUS_CODES = new Set([502, 503, 504]);

class HttpResponseError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
  }
}

/**
 * Thrown when the authorization header resolver fails due to missing or invalid
 * configuration. This is a programmer/operator error, not a transient failure,
 * so it must not be retried.
 */
export class HttpAuthConfigError extends Error {
  public readonly cause: unknown;

  public constructor(cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "Authorization resolver failed";
    super(message);
    this.name = "HttpAuthConfigError";
    this.cause = cause;
  }
}

function shouldRetryHttpRequest(error: unknown): boolean {
  // Auth/config errors are not transient — retrying would never help.
  if (error instanceof HttpAuthConfigError) {
    return false;
  }
  if (error instanceof HttpResponseError) {
    return HTTP_REQUEST_RETRIABLE_STATUS_CODES.has(error.status);
  }
  // A non-HttpResponseError (e.g. fetch rejecting on connection refused) is a
  // transport-level failure that is safe to retry.
  return true;
}

export async function sendJsonRequest<TResponse>(
  options: ServiceClientHttpOptions,
  request: JsonHttpRequest,
): Promise<TResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${trimTrailingSlash(options.baseUrl)}${request.path}`;

  return retryWithBackoff<TResponse>(
    async () => {
      let resolvedAuthorization: string | undefined;
      if (options.authorizationHeaderResolver !== undefined) {
        try {
          resolvedAuthorization = await options.authorizationHeaderResolver();
        } catch (authError) {
          throw new HttpAuthConfigError(authError);
        }
      }

      const response = await fetchImpl(url, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          ...options.headers,
          ...(resolvedAuthorization
            ? { authorization: resolvedAuthorization }
            : {}),
          ...request.headers,
        },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      if (!response.ok) {
        throw new HttpResponseError(
          response.status,
          `HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }

      if (response.status === 204) {
        return undefined as TResponse;
      }

      const payload = await response.text();
      if (!payload) {
        return undefined as TResponse;
      }

      return JSON.parse(payload) as TResponse;
    },
    {
      maxAttempts: HTTP_REQUEST_MAX_ATTEMPTS,
      baseDelayMs: HTTP_REQUEST_RETRY_BASE_MS,
      maxDelayMs: HTTP_REQUEST_RETRY_MAX_MS,
      shouldRetry: shouldRetryHttpRequest,
    },
  );
}
