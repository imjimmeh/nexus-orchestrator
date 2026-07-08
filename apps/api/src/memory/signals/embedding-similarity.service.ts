import { Injectable } from '@nestjs/common';
import { EmbeddingProviderService } from './embedding-provider.service';
import { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { LexicalSimilarityService } from './lexical-similarity.service';
import { RRF_K } from './candidate-similarity.config';
import type {
  CandidateSimilarityScope,
  ICandidateSimilarity,
  SimilarNeighbor,
} from './candidate-similarity.interface';

/**
 * KNN cosine-similarity query against the pgvector `memory_embeddings` table.
 * The `<=>` operator returns the cosine DISTANCE (0 = identical, 2 = opposite),
 * so `1 - distance` yields a similarity score in [−1, 1].
 */
const KNN_QUERY = `
  SELECT owner_id, 1 - (embedding::vector <=> $1::vector) AS score
  FROM memory_embeddings
  WHERE model_id = $2
    AND owner_type = $3
    AND owner_id = ANY($4::uuid[])
  ORDER BY embedding::vector <=> $1::vector
  LIMIT $5
`;

interface EmbeddingRow {
  owner_id: string;
  score: number;
}

interface EmbeddingHit {
  ownerId: string;
  score: number;
}

@Injectable()
export class EmbeddingSimilarityService implements ICandidateSimilarity {
  constructor(
    private readonly embeddingProviderService: EmbeddingProviderService,
    private readonly embeddingRepo: MemoryEmbeddingRepository,
    private readonly candidateRepo: LearningCandidateRepository,
    private readonly lexicalService: LexicalSimilarityService,
  ) {}

  async findNearest(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]> {
    const embedResult = await this.embeddingProviderService.embed([text]);

    if (!embedResult.configured) {
      return this.lexicalFallback(text, k, scope);
    }

    const embeddingArm = await this.runKnnQuery(
      embedResult.vectors[0],
      embedResult.modelId,
      scope,
      k * 2,
    );

    const corpus = await this.buildCorpus(scope);
    const lexicalArm = this.lexicalService.scoreCorpus(
      text,
      k * 2,
      scope.ownerType,
      corpus,
      scope,
    );

    if (lexicalArm.length === 0) {
      return embeddingArm.slice(0, k).map((n) => ({
        ownerType: scope.ownerType,
        ownerId: n.ownerId,
        score: n.score,
      }));
    }

    if (embeddingArm.length === 0) {
      return lexicalArm.slice(0, k);
    }

    return this.applyRrfFusion(embeddingArm, lexicalArm, scope.ownerType, k);
  }

  /**
   * Dedup / near-duplicate matching path — see {@link ICandidateSimilarity}.
   * When an embedding model is configured, returns each neighbor's RAW cosine
   * similarity in ~[0,1] (no RRF fusion), so callers can compare it against a
   * raw-cosine threshold and have that threshold actually fire. When no model
   * is configured, degrades to the same lexical-only fallback as
   * {@link findNearest}.
   */
  async findRawSimilarNeighbors(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]> {
    const embedResult = await this.embeddingProviderService.embed([text]);

    if (!embedResult.configured) {
      return this.lexicalFallback(text, k, scope);
    }

    const neighbours = await this.runKnnQuery(
      embedResult.vectors[0],
      embedResult.modelId,
      scope,
      k,
    );
    return neighbours.map((n) => ({
      ownerType: scope.ownerType,
      ownerId: n.ownerId,
      score: n.score,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Run the pgvector KNN cosine query and map rows to {@link EmbeddingHit}s.
   * Rows arrive ordered by ascending distance (descending similarity); each
   * `score` is the raw cosine similarity `1 - distance`.
   */
  private async runKnnQuery(
    vector: number[],
    modelId: string,
    scope: CandidateSimilarityScope,
    limit: number,
  ): Promise<EmbeddingHit[]> {
    const vectorLiteral = `[${vector.join(',')}]`;
    const rows = await this.embeddingRepo.manager.query<EmbeddingRow[]>(
      KNN_QUERY,
      [vectorLiteral, modelId, scope.ownerType, scope.ownerIds, limit],
    );
    return rows.map((r) => ({ ownerId: r.owner_id, score: r.score }));
  }

  private async lexicalFallback(
    text: string,
    k: number,
    scope: CandidateSimilarityScope,
  ): Promise<SimilarNeighbor[]> {
    const corpus = await this.buildCorpus(scope);
    return this.lexicalService.scoreCorpus(
      text,
      k,
      scope.ownerType,
      corpus,
      scope,
    );
  }

  private async buildCorpus(
    scope: CandidateSimilarityScope,
  ): Promise<Array<{ ownerId: string; content: string }>> {
    if (scope.corpus !== undefined) {
      return scope.corpus;
    }
    if (scope.ownerIds.length === 0) {
      return [];
    }
    const candidates = await this.candidateRepo.findByIds(scope.ownerIds);
    return candidates.map((c) => ({ ownerId: c.id, content: c.rawContent }));
  }

  private applyRrfFusion(
    embeddingArm: EmbeddingHit[],
    lexicalArm: SimilarNeighbor[],
    ownerType: string,
    k: number,
  ): SimilarNeighbor[] {
    const embeddingRanks = new Map(
      embeddingArm.map((item, idx) => [item.ownerId, idx + 1]),
    );
    const lexicalRanks = new Map(
      lexicalArm.map((item, idx) => [item.ownerId, idx + 1]),
    );

    const allIds = new Set([
      ...embeddingArm.map((n) => n.ownerId),
      ...lexicalArm.map((n) => n.ownerId),
    ]);

    const fused: SimilarNeighbor[] = [];
    for (const ownerId of allIds) {
      const embRank = embeddingRanks.get(ownerId);
      const lexRank = lexicalRanks.get(ownerId);

      let score = 0;
      if (embRank !== undefined) score += 1 / (RRF_K + embRank);
      if (lexRank !== undefined) score += 1 / (RRF_K + lexRank);

      fused.push({ ownerType, ownerId, score });
    }

    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, k);
  }
}
