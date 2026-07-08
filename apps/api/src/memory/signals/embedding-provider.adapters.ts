/**
 * Embedding provider adapters — OpenAI-compatible transport + adapter registry.
 *
 * A provider adapter is a thin function that performs the HTTP call for a
 * specific backend.  The registry maps provider names to adapters so that
 * Voyage, Cohere, or any other backend can be wired in without touching the
 * core `EmbeddingProviderService`.  Only the OpenAI-compatible adapter is
 * implemented here; other adapters are left as TODOs.
 */
import { Logger } from '@nestjs/common';
import { stripNullBytes } from '../../common/utils/strip-null-bytes.util';
import type {
  EmbeddingAdapter,
  EmbeddingAdapterRequest,
  EmbeddingAdapterResult,
} from './embedding-provider.adapter.types';

export type {
  EmbeddingAdapter,
  EmbeddingAdapterRequest,
  EmbeddingAdapterResult,
};

const logger = new Logger('EmbeddingProviderAdapters');

// ── OpenAI-compatible adapter ─────────────────────────────────────────────────

interface OpenAiEmbeddingsRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

interface OpenAiEmbeddingsResponse {
  data: Array<{ embedding: unknown; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

function resolveAuthHeader(
  auth: EmbeddingAdapterRequest['auth'],
): string | null {
  if (auth.type === 'api_key') {
    return auth.apiKey ? `Bearer ${stripNullBytes(auth.apiKey)}` : null;
  }
  if (auth.type === 'oauth') {
    return `Bearer ${stripNullBytes(auth.credential.accessToken)}`;
  }
  return null;
}

/**
 * OpenAI-compatible embeddings adapter.
 *
 * Calls `POST {baseUrl}/embeddings` with a JSON body of
 * `{ model, input, dimensions? }`.  The `baseUrl` should point to the
 * versioned API root (e.g. `https://api.openai.com/v1`); the adapter appends
 * `/embeddings`.
 *
 * Throws on any HTTP or parse error — the caller applies fail-soft wrapping.
 */
export const openAiCompatibleAdapter: EmbeddingAdapter = async (
  request: EmbeddingAdapterRequest,
): Promise<EmbeddingAdapterResult> => {
  const { modelName, texts, embeddingDimension, auth, baseUrl } = request;

  const base = baseUrl ?? 'https://api.openai.com/v1';
  const url = `${base}/embeddings`;

  const authorization = resolveAuthHeader(auth);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (authorization) {
    headers['authorization'] = authorization;
  }

  const body: OpenAiEmbeddingsRequest = { model: modelName, input: texts };
  if (embeddingDimension !== null) {
    body.dimensions = embeddingDimension;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const sanitized = stripNullBytes(text);
    logger.warn(
      `Embedding request to ${base} returned HTTP ${response.status}: ${sanitized.slice(0, 200)}`,
    );
    throw new Error(`Embedding provider HTTP ${response.status}`);
  }

  const json = (await response.json()) as OpenAiEmbeddingsResponse;

  const vectors: number[][] = json.data
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error(
          `Embedding response data[${item.index}].embedding is not an array`,
        );
      }
      return item.embedding as number[];
    });

  return {
    vectors,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    totalTokens: json.usage?.total_tokens ?? 0,
  };
};

// ── Adapter registry ─────────────────────────────────────────────────────────

/**
 * Maps provider names to their embedding adapter.  Providers not in this map
 * fall through to the default OpenAI-compatible adapter, which covers OpenAI,
 * self-hosted, and most compatible third-party endpoints.
 *
 * To add Voyage or Cohere, register a named adapter here.
 */
const ADAPTER_REGISTRY: ReadonlyMap<string, EmbeddingAdapter> = new Map<
  string,
  EmbeddingAdapter
>([
  // TODO: register voyage adapter when implemented
  // ['voyage', voyageAdapter],
  // TODO: register cohere adapter when implemented
  // ['cohere', cohereAdapter],
]);

/**
 * Resolves the adapter for a given provider name.  Falls back to the
 * OpenAI-compatible adapter for any unknown provider.
 */
export function resolveEmbeddingAdapter(
  providerName: string,
): EmbeddingAdapter {
  return ADAPTER_REGISTRY.get(providerName) ?? openAiCompatibleAdapter;
}
