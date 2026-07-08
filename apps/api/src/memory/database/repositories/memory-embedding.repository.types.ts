/** Input shape for {@link MemoryEmbeddingRepository.upsert}. */
export interface UpsertEmbeddingInput {
  owner_type: string;
  owner_id: string;
  model_id: string;
  /** Number of dimensions. Must equal `embedding.length`. */
  dim: number;
  /** Raw float values. Serialised to pgvector literal `'[n1,n2,...]'` on write. */
  embedding: number[];
  content_hash: string;
}
