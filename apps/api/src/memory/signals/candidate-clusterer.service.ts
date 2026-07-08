import { Inject, Injectable, Logger } from '@nestjs/common';
import { CANDIDATE_SIMILARITY } from './candidate-similarity.interface';
import type {
  ICandidateSimilarity,
  CandidateSimilarityScope,
} from './candidate-similarity.interface';
import { CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT } from './candidate-similarity.config';
import { EmbeddingProviderService } from './embedding-provider.service';
import { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { ClusterResult } from './candidate-clusterer.types';
import type { SignalCandidate } from './pipeline.types';
import {
  PENDING_STATUS,
  MERGED_STATUS,
  MAX_SIGNAL_LOAD,
} from './signal-load.constants';

export type { ClusterResult } from './candidate-clusterer.types';
export type { SignalCandidate } from './pipeline.types';

// ── Module-level constants ────────────────────────────────────────────────────

const OWNER_TYPE = 'learning_candidate';

/**
 * Number of lexical neighbours to retrieve for each unembedded candidate
 * via the `ICandidateSimilarity` fallback.
 */
const LEXICAL_NEIGHBOURS_K = 50;

const FETCH_EMBEDDINGS_SQL = `
  SELECT owner_id, embedding
  FROM memory_embeddings
  WHERE owner_type = 'learning_candidate'
    AND model_id   = $1
    AND owner_id   = ANY($2::uuid[])
`;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Parse a pgvector text literal `'[0.1,0.2,…]'` into a `number[]`. */
function parseVectorLiteral(literal: string): number[] {
  return literal.slice(1, -1).split(',').map(Number);
}

// ── Union-Find (path-compressed, union-by-rank) ───────────────────────────

class UnionFind {
  private readonly parent: Map<string, string>;
  private readonly rank: Map<string, number>;

  constructor(ids: readonly string[]) {
    this.parent = new Map(ids.map((id) => [id, id]));
    this.rank = new Map(ids.map((id) => [id, 0]));
  }

  find(id: string): string {
    const p = this.parent.get(id) ?? id;
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root);
      return root;
    }
    return id;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Returns a map from component-root → all member IDs in that component. */
  getComponents(): Map<string, string[]> {
    const components = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const group = components.get(root) ?? [];
      group.push(id);
      components.set(root, group);
    }
    return components;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Groups near-duplicate `status='pending'` learning candidates by semantic
 * similarity, collapsing each cluster to one canonical row and recording
 * the cluster size as `recurrence_count`.
 *
 * **Algorithm**
 * 1. Load all pending candidates (up to {@link MAX_SIGNAL_LOAD}).
 * 2. Resolve the active embedding model via `EmbeddingProviderService`.
 * 3. Fetch stored embeddings for candidates that have them.
 * 4. Build Union-Find edges:
 *    - _Embedded_ candidates: pairwise cosine similarity using stored
 *      vectors. O(N²); acceptable at the expected daily-pass scale.
 *    - _Unembedded_ candidates: fall back to
 *      {@link ICandidateSimilarity.findRawSimilarNeighbors}. With an embedding
 *      model configured this compares RAW cosine similarity (a real [0,1]
 *      magnitude) against `candidate_similarity_threshold = 0.85`, so the
 *      threshold actually fires. Without a model it degrades to TF-IDF lexical
 *      search, whose scores are NOT cosine values — applying 0.85 as a TF-IDF
 *      floor is then a best-effort heuristic and false-negatives (missed
 *      clusters) are the graceful, conservative failure mode.
 * 5. Extract connected components; singletons (size = 1) are skipped.
 * 6. Per cluster: elect the canonical candidate (highest
 *    `source_quality_confidence`; tie-break: earliest `first_seen_at`);
 *    set `canonical.recurrence_count = cluster size`; mark every other
 *    member `status='merged'` with `diagnostics_json.merged_into =
 *    canonicalId` (recoverable — prior `diagnostics_json` fields are
 *    spread-preserved).
 *
 * **Idempotency**
 * Only `status='pending'` rows are loaded. Rows already marked `merged`
 * are invisible to a subsequent run, making the operation naturally
 * idempotent.
 */
@Injectable()
export class CandidateClustererService {
  private readonly logger = new Logger(CandidateClustererService.name);

  constructor(
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity,
    private readonly candidateRepo: LearningCandidateRepository,
    private readonly embeddingProvider: EmbeddingProviderService,
    private readonly embeddingRepo: MemoryEmbeddingRepository,
  ) {}

  async cluster(): Promise<ClusterResult> {
    const { data: pending } = await this.candidateRepo.list({
      statuses: [PENDING_STATUS],
      limit: MAX_SIGNAL_LOAD,
      page: 1,
    });

    if (pending.length < 2) {
      return {
        clustersFormed: 0,
        candidatesMerged: 0,
        totalPending: pending.length,
      };
    }

    const modelId = await this.resolveActiveModelId();
    const embeddingMap = await this.fetchEmbeddings(pending, modelId);

    const threshold = CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT;
    const uf = new UnionFind(pending.map((c) => c.id));

    this.addEmbeddingEdges(pending, embeddingMap, threshold, uf);
    await this.addLexicalEdges(pending, embeddingMap, threshold, uf);

    const pendingById = new Map(pending.map((c) => [c.id, c]));
    const components = uf.getComponents();

    let clustersFormed = 0;
    let candidatesMerged = 0;

    for (const members of components.values()) {
      if (members.length < 2) continue;

      // Defensive filter: all member IDs come from the UF which was
      // initialised from `pending`, so missing IDs should never occur.
      const candidates = members
        .map((id) => pendingById.get(id))
        .filter((c): c is LearningCandidate => c !== undefined);

      if (candidates.length < 2) continue;

      const canonical = this.electCanonical(candidates);
      await this.persistCluster(canonical, candidates);
      clustersFormed++;
      candidatesMerged += candidates.length - 1;
    }

    this.logger.log(
      `CandidateClusterer pass: pending=${pending.length.toString()}, ` +
        `clustersFormed=${clustersFormed.toString()}, merged=${candidatesMerged.toString()}`,
    );

    return { clustersFormed, candidatesMerged, totalPending: pending.length };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve the currently-active embedding model id.
   * Returns `null` when no model is configured (triggers full lexical fallback).
   */
  private async resolveActiveModelId(): Promise<string | null> {
    const result = await this.embeddingProvider.embed([
      '_cluster_model_probe_',
    ]);
    return result.configured ? result.modelId : null;
  }

  private async fetchEmbeddings(
    candidates: SignalCandidate[],
    modelId: string | null,
  ): Promise<Map<string, number[]>> {
    if (modelId === null || candidates.length === 0) {
      return new Map();
    }
    const ids = candidates.map((c) => c.id);
    const rows = await this.embeddingRepo.manager.query<
      Array<{ owner_id: string; embedding: string }>
    >(FETCH_EMBEDDINGS_SQL, [modelId, ids]);

    return new Map(
      rows.map((r) => [r.owner_id, parseVectorLiteral(r.embedding)]),
    );
  }

  /**
   * Add Union-Find edges between embedded candidates whose pairwise cosine
   * similarity meets or exceeds `threshold`. Synchronous; O(N²) over
   * the embedded subset.
   */
  private addEmbeddingEdges(
    candidates: SignalCandidate[],
    embeddingMap: Map<string, number[]>,
    threshold: number,
    uf: UnionFind,
  ): void {
    const embedded = candidates.filter((c) => embeddingMap.has(c.id));
    for (let i = 0; i < embedded.length; i++) {
      for (let j = i + 1; j < embedded.length; j++) {
        const vecA = embeddingMap.get(embedded[i].id);
        const vecB = embeddingMap.get(embedded[j].id);
        if (
          vecA !== undefined &&
          vecB !== undefined &&
          cosineSimilarity(vecA, vecB) >= threshold
        ) {
          uf.union(embedded[i].id, embedded[j].id);
        }
      }
    }
  }

  /**
   * Add Union-Find edges for candidates that lack a STORED embedding by
   * querying the raw-similarity path of `ICandidateSimilarity`. When an
   * embedding model is configured the candidate's summary is embedded on the
   * fly and compared by RAW cosine similarity against the stored vectors of
   * its neighbours — a real [0,1] magnitude, so the `threshold` genuinely
   * fires. When no model is configured this degrades to the TF-IDF lexical
   * heuristic (see class JSDoc for that score-semantics limitation).
   */
  private async addLexicalEdges(
    pending: SignalCandidate[],
    embeddingMap: Map<string, number[]>,
    threshold: number,
    uf: UnionFind,
  ): Promise<void> {
    const unembedded = pending.filter((c) => !embeddingMap.has(c.id));
    if (unembedded.length === 0) return;

    const allIds = pending.map((c) => c.id);
    const corpus = pending.map((c) => ({ ownerId: c.id, content: c.summary }));

    for (const candidate of unembedded) {
      const scope: CandidateSimilarityScope = {
        ownerType: OWNER_TYPE,
        ownerIds: allIds.filter((id) => id !== candidate.id),
        corpus,
      };
      // Backfill window: when a model IS configured but the neighbours are not
      // yet embedded (e.g. a fresh pass before embedding backfill runs), raw
      // KNN returns nothing → no edges form for those neighbours this window.
      // This is deliberate — TF-IDF is no longer treated as cosine-scale. The
      // model-NOT-configured case still uses the lexical fallback instead.
      const neighbours = await this.similarity.findRawSimilarNeighbors(
        candidate.summary,
        LEXICAL_NEIGHBOURS_K,
        scope,
      );
      for (const neighbour of neighbours) {
        if (neighbour.score >= threshold) {
          uf.union(candidate.id, neighbour.ownerId);
        }
      }
    }
  }

  /**
   * Elect the canonical candidate from a cluster.
   *
   * Primary criterion: highest `source_quality_confidence`.
   * Tie-break: earliest `first_seen_at` — the observation that has been
   * around longest is most established and therefore authoritative.
   */
  private electCanonical(cluster: LearningCandidate[]): LearningCandidate {
    return cluster.reduce((best, candidate) => {
      if (
        candidate.source_quality_confidence > best.source_quality_confidence
      ) {
        return candidate;
      }
      if (
        candidate.source_quality_confidence ===
          best.source_quality_confidence &&
        candidate.first_seen_at < best.first_seen_at
      ) {
        return candidate;
      }
      return best;
    });
  }

  /**
   * Persist the cluster result:
   *  - Set `canonical.recurrence_count = cluster size`.
   *  - Mark each non-canonical member `status='merged'` with
   *    `diagnostics_json.merged_into = canonical.id` (spread over any
   *    existing `diagnostics_json` so prior annotations are preserved).
   */
  private async persistCluster(
    canonical: LearningCandidate,
    cluster: LearningCandidate[],
  ): Promise<void> {
    await this.candidateRepo.updateById(canonical.id, {
      recurrence_count: cluster.length,
    });

    for (const member of cluster) {
      if (member.id === canonical.id) continue;
      const existingDiag = member.diagnostics_json ?? {};
      await this.candidateRepo.updateById(member.id, {
        status: MERGED_STATUS,
        diagnostics_json: { ...existingDiag, merged_into: canonical.id },
      });
    }
  }
}
