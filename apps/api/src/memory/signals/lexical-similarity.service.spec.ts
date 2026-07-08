import { describe, it, expect } from 'vitest';
import { LexicalSimilarityService } from './lexical-similarity.service';
import type { CandidateSimilarityScope } from './candidate-similarity.interface';

describe('LexicalSimilarityService', () => {
  const svc = new LexicalSimilarityService();

  const scope: CandidateSimilarityScope = {
    ownerType: 'learning_candidate',
    ownerIds: [],
  };

  describe('scoreCorpus', () => {
    it('(d) ranks documents by TF-IDF score descending', () => {
      const corpus = [
        { ownerId: 'a', content: 'memory retrieval vector search' },
        { ownerId: 'b', content: 'unrelated topic about cooking recipes' },
        {
          ownerId: 'c',
          content: 'memory retrieval embedding similarity vector',
        },
      ];
      const results = svc.scoreCorpus(
        'memory retrieval vector',
        10,
        'learning_candidate',
        corpus,
      );
      expect(results.length).toBeGreaterThan(0);
      // c has more overlap terms, or a — both should outrank b
      const bScore = results.find((r) => r.ownerId === 'b')?.score ?? 0;
      const aScore = results.find((r) => r.ownerId === 'a')?.score ?? 0;
      const cScore = results.find((r) => r.ownerId === 'c')?.score ?? 0;
      expect(aScore).toBeGreaterThan(bScore);
      expect(cScore).toBeGreaterThan(bScore);
      // Results sorted descending
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    it('returns empty array for empty corpus', () => {
      expect(svc.scoreCorpus('query', 5, 'learning_candidate', [])).toEqual([]);
    });

    it('returns empty array for empty query', () => {
      expect(
        svc.scoreCorpus('', 5, 'learning_candidate', [
          { ownerId: 'a', content: 'hello' },
        ]),
      ).toEqual([]);
    });

    it('respects k limit', () => {
      const corpus = Array.from({ length: 10 }, (_, i) => ({
        ownerId: String(i),
        content: `memory retrieval ${i}`,
      }));
      expect(
        svc.scoreCorpus('memory retrieval', 3, 'learning_candidate', corpus)
          .length,
      ).toBeLessThanOrEqual(3);
    });

    it('filters by scope.ownerIds when provided', () => {
      const corpus = [
        { ownerId: 'a', content: 'memory retrieval' },
        { ownerId: 'b', content: 'memory retrieval' },
        { ownerId: 'c', content: 'memory retrieval' },
      ];
      const scopeWithIds: CandidateSimilarityScope = {
        ownerType: 'learning_candidate',
        ownerIds: ['a', 'c'],
      };
      const results = svc.scoreCorpus(
        'memory',
        10,
        'learning_candidate',
        corpus,
        scopeWithIds,
      );
      const ids = results.map((r) => r.ownerId);
      expect(ids).not.toContain('b');
    });
  });

  describe('findNearest', () => {
    it('uses scope.corpus when provided', async () => {
      const scopeWithCorpus: CandidateSimilarityScope = {
        ownerType: 'learning_candidate',
        ownerIds: [],
        corpus: [{ ownerId: 'x', content: 'memory vector retrieval' }],
      };
      const results = await svc.findNearest(
        'memory retrieval',
        5,
        scopeWithCorpus,
      );
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty array when no corpus provided', async () => {
      const results = await svc.findNearest('memory retrieval', 5, scope);
      expect(results).toEqual([]);
    });
  });
});
