import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingSimilarityService } from './embedding-similarity.service';
import { LexicalSimilarityService } from './lexical-similarity.service';
import type { EmbeddingProviderService } from './embedding-provider.service';
import type { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { CandidateSimilarityScope } from './candidate-similarity.interface';

const makeEmbedProviderMock = (configured: boolean) => ({
  embed: vi.fn().mockResolvedValue(
    configured
      ? {
          configured: true,
          modelId: 'model-uuid',
          dim: 3,
          vectors: [[0.1, 0.2, 0.3]],
        }
      : { configured: false },
  ),
});

const makeEmbeddingRepoMock = (
  rows: Array<{ owner_id: string; score: number }>,
) => ({
  manager: {
    query: vi.fn().mockResolvedValue(rows),
  },
});

const makeCandidateRepoMock = (
  candidates: Array<{ id: string; rawContent: string }>,
) => ({
  findByIds: vi.fn().mockResolvedValue(candidates),
});

describe('EmbeddingSimilarityService', () => {
  let lexical: LexicalSimilarityService;

  beforeEach(() => {
    lexical = new LexicalSimilarityService();
  });

  const scope: CandidateSimilarityScope = {
    ownerType: 'learning_candidate',
    ownerIds: ['id-1', 'id-2'],
  };

  it('(a) findNearest with configured model → calls embed, runs KNN SQL, returns ordered neighbors', async () => {
    const embedProvider = makeEmbedProviderMock(
      true,
    ) as unknown as EmbeddingProviderService;
    const embeddingRepo = makeEmbeddingRepoMock([
      { owner_id: 'id-1', score: 0.95 },
      { owner_id: 'id-2', score: 0.75 },
    ]) as unknown as MemoryEmbeddingRepository;
    const candidateRepo = makeCandidateRepoMock([
      { id: 'id-1', rawContent: 'memory retrieval vector' },
      { id: 'id-2', rawContent: 'learning pipeline' },
    ]) as unknown as LearningCandidateRepository;

    const svc = new EmbeddingSimilarityService(
      embedProvider,
      embeddingRepo,
      candidateRepo,
      lexical,
    );
    const results = await svc.findNearest('memory vector search', 5, scope);

    expect(embedProvider.embed).toHaveBeenCalledWith(['memory vector search']);
    expect(embeddingRepo.manager.query).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    // Should be ordered by score descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('(b) findNearest with {configured:false} → falls back to lexical', async () => {
    const embedProvider = makeEmbedProviderMock(
      false,
    ) as unknown as EmbeddingProviderService;
    const embeddingRepo = makeEmbeddingRepoMock(
      [],
    ) as unknown as MemoryEmbeddingRepository;
    const candidateRepo = makeCandidateRepoMock([
      { id: 'id-1', rawContent: 'memory retrieval vector search' },
      { id: 'id-2', rawContent: 'unrelated topic' },
    ]) as unknown as LearningCandidateRepository;

    const svc = new EmbeddingSimilarityService(
      embedProvider,
      embeddingRepo,
      candidateRepo,
      lexical,
    );
    const results = await svc.findNearest('memory retrieval', 5, scope);

    // Embedding SQL should NOT be called
    expect(embeddingRepo.manager.query).not.toHaveBeenCalled();
    // Lexical results should surface
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].ownerId).toBe('id-1');
  });

  it('(c) Hybrid fusion — lexical-exact match that embedding misses still surfaces', async () => {
    const embedProvider = makeEmbedProviderMock(
      true,
    ) as unknown as EmbeddingProviderService;
    // Embedding only returns id-1 (id-3 is missing from embedding index)
    const embeddingRepo = makeEmbeddingRepoMock([
      { owner_id: 'id-1', score: 0.9 },
    ]) as unknown as MemoryEmbeddingRepository;
    const candidateRepo = makeCandidateRepoMock([
      { id: 'id-1', rawContent: 'memory vector similarity' },
      { id: 'id-3', rawContent: 'memory retrieval exact match query term' },
    ]) as unknown as LearningCandidateRepository;

    const scopeWithThree: CandidateSimilarityScope = {
      ownerType: 'learning_candidate',
      ownerIds: ['id-1', 'id-3'],
    };

    const svc = new EmbeddingSimilarityService(
      embedProvider,
      embeddingRepo,
      candidateRepo,
      lexical,
    );
    const results = await svc.findNearest(
      'memory retrieval exact match query term',
      5,
      scopeWithThree,
    );

    const ids = results.map((r) => r.ownerId);
    // id-3 should surface even though embedding missed it (lexical arm catches it)
    expect(ids).toContain('id-3');
  });

  it('(raw-a) findRawSimilarNeighbors with configured model → returns RAW cosine similarity, not an RRF-fused score', async () => {
    const embedProvider = makeEmbedProviderMock(
      true,
    ) as unknown as EmbeddingProviderService;
    // KNN returns a near-duplicate (0.9) and an unrelated neighbor (0.2).
    const embeddingRepo = makeEmbeddingRepoMock([
      { owner_id: 'id-1', score: 0.9 },
      { owner_id: 'id-2', score: 0.2 },
    ]) as unknown as MemoryEmbeddingRepository;
    const candidateRepo = makeCandidateRepoMock([
      { id: 'id-1', rawContent: 'memory retrieval vector' },
      { id: 'id-2', rawContent: 'unrelated topic' },
    ]) as unknown as LearningCandidateRepository;

    const svc = new EmbeddingSimilarityService(
      embedProvider,
      embeddingRepo,
      candidateRepo,
      lexical,
    );
    const results = await svc.findRawSimilarNeighbors(
      'memory vector search',
      5,
      scope,
    );

    expect(embedProvider.embed).toHaveBeenCalledWith(['memory vector search']);
    expect(embeddingRepo.manager.query).toHaveBeenCalled();
    // Raw cosine magnitude is preserved verbatim — the near-duplicate crosses
    // the 0.85 dedup threshold, which a ~0.03 RRF-fused score never could.
    const near = results.find((r) => r.ownerId === 'id-1');
    const far = results.find((r) => r.ownerId === 'id-2');
    expect(near?.score).toBe(0.9);
    expect(near?.score).toBeGreaterThan(0.85);
    expect(far?.score).toBe(0.2);
  });

  it('(raw-b) findRawSimilarNeighbors with {configured:false} → lexical fallback, no KNN query', async () => {
    const embedProvider = makeEmbedProviderMock(
      false,
    ) as unknown as EmbeddingProviderService;
    const embeddingRepo = makeEmbeddingRepoMock(
      [],
    ) as unknown as MemoryEmbeddingRepository;
    const candidateRepo = makeCandidateRepoMock([
      { id: 'id-1', rawContent: 'memory retrieval vector search' },
      { id: 'id-2', rawContent: 'unrelated topic' },
    ]) as unknown as LearningCandidateRepository;

    const svc = new EmbeddingSimilarityService(
      embedProvider,
      embeddingRepo,
      candidateRepo,
      lexical,
    );
    const results = await svc.findRawSimilarNeighbors(
      'memory retrieval',
      5,
      scope,
    );

    // No embedding model configured → KNN SQL must NOT run; lexical fallback surfaces.
    expect(embeddingRepo.manager.query).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].ownerId).toBe('id-1');
  });
});
