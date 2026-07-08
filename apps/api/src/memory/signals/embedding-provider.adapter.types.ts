import type { RunnerProviderAuth } from '@nexus/core';

export interface EmbeddingAdapterRequest {
  modelName: string;
  texts: string[];
  embeddingDimension: number | null;
  auth: RunnerProviderAuth;
  baseUrl?: string;
}

export interface EmbeddingAdapterResult {
  /** One vector per input text, in the same order as `texts`. */
  vectors: number[][];
  /** Tokens consumed by the provider (for budget recording). */
  promptTokens: number;
  totalTokens: number;
}

/**
 * An embedding adapter performs the actual HTTP round-trip for one provider
 * backend and returns vectors + token counts.  It MUST throw on any failure so
 * that the calling service can apply fail-soft logic in a single place.
 */
export type EmbeddingAdapter = (
  request: EmbeddingAdapterRequest,
) => Promise<EmbeddingAdapterResult>;
