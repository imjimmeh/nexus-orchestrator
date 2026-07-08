/**
 * Deterministic title key used for exact-duplicate detection. This is
 * currently `CodeChangeDedupService`'s only dedup tier — see that service's
 * doc comment for why an embedding/lexical-similarity tier is intentionally
 * not wired in (the shared `EmbeddingSimilarityService`'s RRF-fused score
 * can never cross the configured similarity threshold).
 */
export function normalizeCodeChangeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
