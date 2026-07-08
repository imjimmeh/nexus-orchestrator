export interface HarnessHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface HarnessHttpClient {
  get(
    url: string,
    options?: { timeoutMs?: number },
  ): Promise<HarnessHttpResponse>;
}
