import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateClustererService } from './candidate-clusterer.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { EmbeddingProviderService } from './embedding-provider.service';
import type { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import type {
  ICandidateSimilarity,
  SimilarNeighbor,
} from './candidate-similarity.interface';

// ── Fixture helpers ──────────────────────────────────────────────────────────

const OWNER_TYPE = 'learning_candidate';
const SAME_VECTOR = '[1,0,0]';

let candidateSeq = 0;

function makeCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  candidateSeq++;
  return {
    id: `cand-${candidateSeq.toString().padStart(3, '0')}`,
    scope_type: 'global',
    scopeId: null,
    candidate_type: 'ambiguous_failure',
    title: 'Ambiguous failure',
    summary: `Ambiguous failure observed in retry logic — case ${candidateSeq.toString()}`,
    fingerprint: `fp-${candidateSeq.toString()}`,
    signals_json: {},
    score: 0.5,
    confidence: 0.7,
    recurrence_count: 1,
    stage_diversity_count: 1,
    routing_target: null,
    failure_reduction_relevance: 0.6,
    recency_decay: 1.0,
    source_quality_confidence: 0.5,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: new Date('2024-01-01T00:00:00Z'),
    last_seen_at: new Date('2024-01-01T00:00:00Z'),
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface MakeSvcOptions {
  pendingCandidates?: LearningCandidate[];
  embeddingRows?: Array<{ owner_id: string; embedding: string }>;
  modelConfigured?: boolean;
  modelId?: string;
  similarityNeighbors?: SimilarNeighbor[];
}

function makeSvc(options: MakeSvcOptions = {}) {
  const {
    pendingCandidates = [],
    embeddingRows = [],
    modelConfigured = true,
    modelId = 'model-uuid-1',
    similarityNeighbors = [],
  } = options;

  const candidateRepo = {
    list: vi.fn().mockResolvedValue({
      data: pendingCandidates,
      total: pendingCandidates.length,
    }),
    updateById: vi.fn().mockResolvedValue(null),
  } as unknown as LearningCandidateRepository;

  const embeddingProvider = {
    embed: vi
      .fn()
      .mockResolvedValue(
        modelConfigured
          ? { configured: true, modelId, dim: 3, vectors: [[1, 0, 0]] }
          : { configured: false },
      ),
  } as unknown as EmbeddingProviderService;

  const embeddingRepo = {
    manager: {
      query: vi.fn().mockResolvedValue(embeddingRows),
    },
  } as unknown as MemoryEmbeddingRepository;

  const similarity = {
    findNearest: vi.fn().mockResolvedValue(similarityNeighbors),
    findRawSimilarNeighbors: vi.fn().mockResolvedValue(similarityNeighbors),
  } as unknown as ICandidateSimilarity;

  const svc = new CandidateClustererService(
    similarity,
    candidateRepo,
    embeddingProvider,
    embeddingRepo,
  );

  return { svc, candidateRepo, embeddingProvider, embeddingRepo, similarity };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CandidateClustererService', () => {
  beforeEach(() => {
    candidateSeq = 0;
  });

  it('requests the first page of pending candidates (offset:0 -> page:1, Task 17)', async () => {
    const { svc, candidateRepo } = makeSvc({ pendingCandidates: [] });

    await svc.cluster();

    expect(candidateRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['pending'], page: 1 }),
    );
  });

  // ── (a) 26 near-duplicates collapse to one canonical ───────────────────

  it('(a) collapses 26 near-duplicate candidates into one canonical with recurrence_count=26', async () => {
    const highQualityId = 'hq-canonical';
    const lowQualityIds = Array.from(
      { length: 25 },
      (_, i) => `lq-${i.toString()}`,
    );

    const highQuality = makeCandidate({
      id: highQualityId,
      source_quality_confidence: 0.9,
    });
    const lowQuality = lowQualityIds.map((id) =>
      makeCandidate({ id, source_quality_confidence: 0.5 }),
    );
    const candidates = [highQuality, ...lowQuality];

    // All candidates share the same embedding → pairwise cosine = 1.0 ≥ 0.85
    const embeddingRows = candidates.map((c) => ({
      owner_id: c.id,
      embedding: SAME_VECTOR,
    }));

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: candidates,
      embeddingRows,
    });

    const result = await svc.cluster();

    expect(result.clustersFormed).toBe(1);
    expect(result.candidatesMerged).toBe(25);
    expect(result.totalPending).toBe(26);

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;

    // The high-quality canonical must be updated with recurrence_count=26
    const canonicalUpdate = updateCalls.find(
      ([id, data]) => id === highQualityId && data['recurrence_count'] === 26,
    );
    expect(canonicalUpdate).toBeDefined();

    // 25 members must be marked merged with merged_into pointing at the canonical
    const mergedUpdates = updateCalls.filter(
      ([, data]) => data['status'] === 'merged',
    );
    expect(mergedUpdates).toHaveLength(25);

    for (const [, data] of mergedUpdates) {
      const diag = data['diagnostics_json'] as Record<string, unknown>;
      expect(diag?.['merged_into']).toBe(highQualityId);
    }
  });

  // ── (b) Dissimilar candidates remain as singletons ────────────────────

  it('(b) leaves dissimilar candidates as singletons — no merges, no updateById calls', async () => {
    // Orthogonal unit vectors → pairwise cosine = 0 < 0.85
    const candidates = [
      makeCandidate({ id: 'cand-x' }),
      makeCandidate({ id: 'cand-y' }),
      makeCandidate({ id: 'cand-z' }),
    ];
    const embeddingRows = [
      { owner_id: 'cand-x', embedding: '[1,0,0]' },
      { owner_id: 'cand-y', embedding: '[0,1,0]' },
      { owner_id: 'cand-z', embedding: '[0,0,1]' },
    ];

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: candidates,
      embeddingRows,
    });

    const result = await svc.cluster();

    expect(result.clustersFormed).toBe(0);
    expect(result.candidatesMerged).toBe(0);
    expect(candidateRepo.updateById).not.toHaveBeenCalled();
  });

  // ── (c) Canonical election: highest source_quality_confidence ────────

  it('(c) elects the candidate with highest source_quality_confidence as canonical', async () => {
    const candidates = [
      makeCandidate({ id: 'low', source_quality_confidence: 0.3 }),
      makeCandidate({ id: 'medium', source_quality_confidence: 0.7 }),
      makeCandidate({ id: 'high', source_quality_confidence: 0.9 }),
    ];
    const embeddingRows = candidates.map((c) => ({
      owner_id: c.id,
      embedding: SAME_VECTOR,
    }));

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: candidates,
      embeddingRows,
    });

    await svc.cluster();

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;

    const canonicalUpdate = updateCalls.find(
      ([id, data]) => id === 'high' && data['recurrence_count'] === 3,
    );
    expect(canonicalUpdate).toBeDefined();

    const mergedUpdates = updateCalls.filter(
      ([, data]) => data['status'] === 'merged',
    );
    expect(mergedUpdates).toHaveLength(2);

    for (const [, data] of mergedUpdates) {
      const diag = data['diagnostics_json'] as Record<string, unknown>;
      expect(diag?.['merged_into']).toBe('high');
    }
  });

  it('(c2) tie-breaks canonical election by earliest first_seen_at when confidence is equal', async () => {
    const candidates = [
      makeCandidate({
        id: 'newer',
        source_quality_confidence: 0.7,
        first_seen_at: new Date('2024-06-01T00:00:00Z'),
      }),
      makeCandidate({
        id: 'older',
        source_quality_confidence: 0.7,
        first_seen_at: new Date('2024-01-01T00:00:00Z'),
      }),
    ];
    const embeddingRows = candidates.map((c) => ({
      owner_id: c.id,
      embedding: SAME_VECTOR,
    }));

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: candidates,
      embeddingRows,
    });

    await svc.cluster();

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;

    // 'older' has the earliest first_seen_at → canonical
    const canonicalUpdate = updateCalls.find(
      ([id, data]) => id === 'older' && data['recurrence_count'] === 2,
    );
    expect(canonicalUpdate).toBeDefined();

    // 'newer' must be merged into 'older'
    const mergedUpdate = updateCalls.find(([id]) => id === 'newer');
    expect(mergedUpdate).toBeDefined();
    const [, mergedData] = mergedUpdate!;
    expect(mergedData['status']).toBe('merged');
    const diag = mergedData['diagnostics_json'] as Record<string, unknown>;
    expect(diag?.['merged_into']).toBe('older');
  });

  // ── (d) Idempotency ───────────────────────────────────────────────────

  it('(d) is idempotent — re-running when only the canonical remains does not trigger additional merges', async () => {
    // Simulate second run: only the canonical row is still 'pending'
    const canonical = makeCandidate({
      id: 'canonical-row',
      recurrence_count: 26,
    });

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: [canonical],
      embeddingRows: [{ owner_id: 'canonical-row', embedding: SAME_VECTOR }],
    });

    const result = await svc.cluster();

    // Single pending candidate → no clustering possible
    expect(result.clustersFormed).toBe(0);
    expect(result.candidatesMerged).toBe(0);
    expect(candidateRepo.updateById).not.toHaveBeenCalled();
  });

  it('(d2) already-merged rows are invisible to re-runs — pending filter is the idempotency guard', async () => {
    // The repo returns only the canonical (already-merged rows are status='merged'
    // and therefore excluded by the statuses=['pending'] filter)
    const canonical = makeCandidate({ id: 'sole-pending' });

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: [canonical],
      embeddingRows: [{ owner_id: 'sole-pending', embedding: SAME_VECTOR }],
    });

    await svc.cluster();

    // Verify the repo was queried with statuses=['pending']
    expect(candidateRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['pending'] }),
    );
    // No updates — single row cannot form a cluster
    expect(candidateRepo.updateById).not.toHaveBeenCalled();
  });

  // ── (e) Lexical fallback for candidates without embeddings ────────────

  it('(e) lexical fallback: clusters candidates with no stored embeddings via ICandidateSimilarity', async () => {
    const candA = makeCandidate({
      id: 'lex-a',
      summary: 'ambiguous failure in retry logic',
      source_quality_confidence: 0.8,
      first_seen_at: new Date('2024-01-01T00:00:00Z'),
    });
    const candB = makeCandidate({
      id: 'lex-b',
      summary: 'ambiguous failure retry logic issue',
      source_quality_confidence: 0.5,
      first_seen_at: new Date('2024-02-01T00:00:00Z'),
    });

    // Simulate: no embedding model configured → all candidates are unembedded
    const { svc, candidateRepo, similarity } = makeSvc({
      pendingCandidates: [candA, candB],
      embeddingRows: [], // no stored embeddings
      modelConfigured: false,
      // findNearest returns lex-b as similar to lex-a (score 0.92 ≥ 0.85)
      similarityNeighbors: [
        { ownerType: OWNER_TYPE, ownerId: 'lex-b', score: 0.92 },
      ],
    });

    const result = await svc.cluster();

    // The raw-similarity path must have been called for unembedded candidates
    expect(
      (similarity.findRawSimilarNeighbors as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBeGreaterThan(0);

    // A cluster should have formed
    expect(result.clustersFormed).toBe(1);
    expect(result.candidatesMerged).toBe(1);

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;

    // lex-a (higher quality) is canonical with recurrence_count=2
    const canonicalUpdate = updateCalls.find(
      ([id, data]) => id === 'lex-a' && data['recurrence_count'] === 2,
    );
    expect(canonicalUpdate).toBeDefined();

    // lex-b is merged
    const mergedUpdate = updateCalls.find(([id]) => id === 'lex-b');
    expect(mergedUpdate).toBeDefined();
    const [, mergedData] = mergedUpdate!;
    expect(mergedData['status']).toBe('merged');
  });

  // ── (e2) Lexical fallback preserves existing diagnostics_json ─────────

  it('(e2) merged candidates preserve existing diagnostics_json fields alongside merged_into', async () => {
    const existing = { prior_note: 'had an earlier annotation' };
    const candA = makeCandidate({
      id: 'diag-a',
      source_quality_confidence: 0.9,
    });
    const candB = makeCandidate({
      id: 'diag-b',
      source_quality_confidence: 0.5,
      diagnostics_json: existing,
    });
    const embeddingRows = [candA, candB].map((c) => ({
      owner_id: c.id,
      embedding: SAME_VECTOR,
    }));

    const { svc, candidateRepo } = makeSvc({
      pendingCandidates: [candA, candB],
      embeddingRows,
    });

    await svc.cluster();

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;

    const mergedUpdate = updateCalls.find(([id]) => id === 'diag-b');
    expect(mergedUpdate).toBeDefined();
    const [, mergedData] = mergedUpdate!;
    const diag = mergedData['diagnostics_json'] as Record<string, unknown>;
    // Both the prior note and merged_into must be present
    expect(diag?.['prior_note']).toBe('had an earlier annotation');
    expect(diag?.['merged_into']).toBe('diag-a');
  });

  // ── (e3) Raw-similarity edges: a near-dup (≥0.85) matches, unrelated (<0.85) does not ──

  it('(e3) raw-similarity path clusters a near-duplicate neighbour and ignores an unrelated one', async () => {
    const canonical = makeCandidate({
      id: 'raw-canonical',
      source_quality_confidence: 0.9,
    });
    const nearDup = makeCandidate({
      id: 'raw-near',
      source_quality_confidence: 0.5,
    });
    const unrelated = makeCandidate({
      id: 'raw-unrelated',
      source_quality_confidence: 0.5,
    });

    // No stored embeddings → every candidate takes the raw-similarity edge path.
    const { svc, candidateRepo, similarity } = makeSvc({
      pendingCandidates: [canonical, nearDup, unrelated],
      embeddingRows: [],
      modelConfigured: true,
    });

    // addLexicalEdges queries the unembedded candidates in insertion order
    // [canonical, nearDup, unrelated]. Raw cosine says the first two are
    // mutually similar (≥0.85); the unrelated candidate matches nothing.
    (similarity.findRawSimilarNeighbors as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { ownerType: OWNER_TYPE, ownerId: 'raw-near', score: 0.9 },
      ])
      .mockResolvedValueOnce([
        { ownerType: OWNER_TYPE, ownerId: 'raw-canonical', score: 0.9 },
      ])
      .mockResolvedValueOnce([]);

    const result = await svc.cluster();

    expect(similarity.findRawSimilarNeighbors).toHaveBeenCalled();
    // Only raw-canonical + raw-near collapse; raw-unrelated stays a singleton.
    expect(result.clustersFormed).toBe(1);
    expect(result.candidatesMerged).toBe(1);

    const updateCalls = (candidateRepo.updateById as ReturnType<typeof vi.fn>)
      .mock.calls as Array<[string, Record<string, unknown>]>;
    const mergedIds = updateCalls
      .filter(([, data]) => data['status'] === 'merged')
      .map(([id]) => id);
    expect(mergedIds).toContain('raw-near');
    expect(mergedIds).not.toContain('raw-unrelated');
  });

  // ── (e4) Sub-threshold raw neighbour → no edge (pins the clusterer's own gate) ──

  it('(e4) raw-similarity path does NOT create an edge for a sub-threshold (0.2) neighbour', async () => {
    const candA = makeCandidate({
      id: 'sub-a',
      source_quality_confidence: 0.9,
    });
    const candB = makeCandidate({
      id: 'sub-b',
      source_quality_confidence: 0.5,
    });

    // Model configured but no stored embeddings → raw-similarity edge path.
    // The only neighbour returned scores 0.2, below the 0.85 threshold.
    const { svc, candidateRepo, similarity } = makeSvc({
      pendingCandidates: [candA, candB],
      embeddingRows: [],
      modelConfigured: true,
      similarityNeighbors: [
        { ownerType: OWNER_TYPE, ownerId: 'sub-b', score: 0.2 },
      ],
    });

    const result = await svc.cluster();

    expect(similarity.findRawSimilarNeighbors).toHaveBeenCalled();
    // 0.2 < 0.85 → the clusterer's `neighbour.score >= threshold` gate rejects
    // the edge; both candidates stay singletons.
    expect(result.clustersFormed).toBe(0);
    expect(result.candidatesMerged).toBe(0);
    expect(candidateRepo.updateById).not.toHaveBeenCalled();
  });
});
