import { Injectable } from '@nestjs/common';
import type {
  HttpJsonClient,
  HttpJsonRequest,
  HttpJsonResponse,
  TokenScheme,
} from './http-json-client.types';

function authHeader(
  scheme: TokenScheme | undefined,
  token: string,
): Record<string, string> {
  switch (scheme) {
    case 'private-token':
      return { 'PRIVATE-TOKEN': token };
    case 'basic-token':
      return {
        Authorization: `Basic ${Buffer.from(`x-token-auth:${token}`).toString('base64')}`,
      };
    case 'bearer':
    default:
      return { Authorization: `Bearer ${token}` };
  }
}

/**
 * Minimal JSON-over-HTTP client for the GitLab/Bitbucket adapters. Wraps global
 * `fetch` behind an injectable seam so tests mock it with zero network. The token
 * is placed only into the Authorization/PRIVATE-TOKEN header — never logged and
 * never included in a thrown error message.
 */
@Injectable()
export class FetchHttpJsonClient implements HttpJsonClient {
  async request<T = unknown>(
    args: HttpJsonRequest,
  ): Promise<HttpJsonResponse<T>> {
    const response = await fetch(args.url, {
      method: args.method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader(args.tokenScheme, args.token),
        ...(args.headers ?? {}),
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} from ${args.method} ${new URL(args.url).pathname}`,
      );
    }
    const data = (await response.json()) as T;
    return { status: response.status, data };
  }
}
