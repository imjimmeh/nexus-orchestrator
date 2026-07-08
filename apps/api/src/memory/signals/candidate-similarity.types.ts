export interface SimilarNeighbor {
  ownerType: string;
  ownerId: string;
  score: number;
}

export interface CandidateSimilarityScope {
  /** Owner type to filter on — typically 'learning_candidate' */
  ownerType: string;
  /** Allowlist of owner IDs to consider; empty = all of ownerType */
  ownerIds: string[];
  /**
   * Pre-fetched corpus for lexical arm.
   * When absent, EmbeddingSimilarityService fetches from DB;
   * LexicalSimilarityService returns [] if absent.
   */
  corpus?: Array<{ ownerId: string; content: string }>;
}

export interface ICandidateSimilarity {
  /**
   * Ranked-retrieval path. When both the embedding and lexical arms are
   * non-empty the returned `score` is an **RRF-fused rank score** (magnitude is
   * discarded in favour of relative order). Correct for ranked retrieval;
   * NOT comparable to a raw-cosine threshold such as
   * `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT`.
   */
  findNearest(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]>;

  /**
   * Dedup / near-duplicate matching path. When an embedding model is
   * configured, each returned neighbor's `score` is the **raw cosine
   * similarity** in ~[0,1] — directly comparable to
   * `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT`. Unlike {@link findNearest} this
   * never applies RRF fusion, so a genuine near-duplicate can actually cross
   * the threshold. When no embedding model is configured it preserves the
   * lexical-only fallback semantics of {@link findNearest} (unbounded TF-IDF
   * scores — a best-effort heuristic, not a normalized similarity).
   */
  findRawSimilarNeighbors(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]>;
}
