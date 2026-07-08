import { Injectable } from '@nestjs/common';
import { tokenize } from '../../ai-config/services/skill-search/skill-search-strategy.interface';
import type {
  CandidateSimilarityScope,
  ICandidateSimilarity,
  SimilarNeighbor,
} from './candidate-similarity.interface';

@Injectable()
export class LexicalSimilarityService implements ICandidateSimilarity {
  /**
   * Score a corpus against a query using TF-IDF and return the top-k neighbors.
   *
   * Smoothed IDF formula: `log((N+1)/(df+1)) + 1` avoids log(0) and gives
   * every in-corpus term a non-zero IDF floor.
   *
   * @param query    - Free-text query string.
   * @param k        - Maximum number of results to return.
   * @param ownerType - Propagated to each `SimilarNeighbor.ownerType`.
   * @param corpus   - Documents to score.
   * @param scope    - When `scope.ownerIds` is non-empty, only documents whose
   *                   `ownerId` is in the allowlist are considered.
   */
  scoreCorpus(
    query: string,
    k: number,
    ownerType: string,
    corpus: Array<{ ownerId: string; content: string }>,
    scope?: CandidateSimilarityScope,
  ): SimilarNeighbor[] {
    if (query.length === 0 || corpus.length === 0) {
      return [];
    }

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const filtered =
      scope !== undefined && scope.ownerIds.length > 0
        ? corpus.filter((c) => scope.ownerIds.includes(c.ownerId))
        : corpus;

    if (filtered.length === 0) {
      return [];
    }

    const docCount = filtered.length;

    // Build document-frequency map: how many documents contain each term.
    const df = new Map<string, number>();
    const docTokens = filtered.map((doc) => {
      const tokens = tokenize(doc.content);
      const unique = new Set(tokens);
      unique.forEach((term) => df.set(term, (df.get(term) ?? 0) + 1));
      return { ownerId: doc.ownerId, tokens };
    });

    const scored: SimilarNeighbor[] = docTokens.map(({ ownerId, tokens }) => {
      if (tokens.length === 0) {
        return { ownerType, ownerId, score: 0 };
      }

      // Term-frequency map for this document.
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));

      let score = 0;
      for (const term of queryTokens) {
        const termCount = tf.get(term) ?? 0;
        if (termCount === 0) {
          continue;
        }
        const termTf = termCount / tokens.length;
        const termDf = df.get(term) ?? 0;
        // Smoothed IDF to keep scores finite even for single-document corpora.
        const idf = Math.log((docCount + 1) / (termDf + 1)) + 1;
        score += termTf * idf;
      }

      return { ownerType, ownerId, score };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  findNearest(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]> {
    if (scope.corpus === undefined) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.scoreCorpus(text, k, scope.ownerType, scope.corpus, scope),
    );
  }

  /**
   * This implementation has no embedding arm, so the "raw" path is identical to
   * the lexical-only fallback — see {@link ICandidateSimilarity}. Scores remain
   * unbounded TF-IDF sums (a best-effort heuristic, not a cosine magnitude).
   */
  findRawSimilarNeighbors(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]> {
    return this.findNearest(text, k, scope);
  }
}
