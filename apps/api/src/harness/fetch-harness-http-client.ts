import { Injectable } from '@nestjs/common';
import type {
  HarnessHttpClient,
  HarnessHttpResponse,
} from './harness-http-client.types.js';

const DEFAULT_TIMEOUT_MS = 3000;

@Injectable()
export class FetchHarnessHttpClient implements HarnessHttpClient {
  async get(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<HarnessHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json() as Promise<unknown>,
      };
    } catch {
      return { ok: false, status: 0, json: () => Promise.resolve(null) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
