/**
 * Discriminated result type for embedding provider calls.
 *
 * The `configured: false` arm covers both "no active model configured" and
 * "provider call failed" — callers treat both identically and fall back to
 * lexical / recency retrieval.  This ensures the write path is never blocked
 * by embedding failures.
 */
export type EmbedResult =
  | { configured: false }
  | {
      configured: true;
      /** Database id of the `LlmModel` that produced these vectors. */
      modelId: string;
      /** Dimensionality of each vector in `vectors`. */
      dim: number;
      /** One embedding vector per input text, in the same order as the input. */
      vectors: number[][];
    };

/**
 * Contract for an embedding provider that turns text into dense vectors.
 *
 * Implementations MUST be fail-soft: any configuration absence or provider
 * error returns `{ configured: false }` — they MUST NOT throw.
 */
export interface IEmbeddingProvider {
  embed(texts: string[]): Promise<EmbedResult>;
}
