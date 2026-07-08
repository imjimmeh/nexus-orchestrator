/**
 * `MemoryRetrievalService` — replaces recency-ordered truncation with
 * relevance-ranked hybrid vector recall (EPIC-212 Phase 1, Task 9).
 *
 * ## Hybrid path
 *
 *   1. Fetch all non-archived `memory_segments` for the four-pool union:
 *      project scope + global + (optional) agent profile + (optional) workflow.
 *   2. Embed the current `queryText` via `EmbeddingProviderService`.
 *      If the provider returns `{configured:false}`, skip to recency fallback.
 *   3. Run scope-filtered KNN + lexical RRF over `memory_embeddings` via
 *      `EmbeddingSimilarityService.findNearest`.
 *   4. Re-rank the neighbours by:
 *        composite = cosine_rrf × recency_decay × usefulness × pinned_boost
 *   5. Trim the ranked list to fit within `tokenBudget` (rough 4 chars/token
 *      estimate).
 *
 * ## Recency fallback
 *
 * Used when:
 *   - `memory_retrieval_mode = 'recency'` operator override
 *   - `queryText` is blank / whitespace-only
 *   - embedding model not configured (`{configured:false}`)
 *   - any error during hybrid retrieval (fail-soft guarantee)
 *
 * ## Fail-soft guarantee
 *
 * Any error in the hybrid path is caught and logged; the service falls back
 * to the recency path so a provider outage can NEVER break prompt assembly.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { MemorySegment } from '../database/entities/memory-segment.entity';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingSimilarityService } from './embedding-similarity.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import {
  MEMORY_RETRIEVAL_MODE_SETTING,
  MEMORY_RETRIEVAL_MODE_DEFAULT,
  MEMORY_RETRIEVAL_HYBRID_CANDIDATE_K,
  MEMORY_RETRIEVAL_RECENCY_LAMBDA,
  MEMORY_RETRIEVAL_PINNED_BOOST,
  MEMORY_RETRIEVAL_USEFULNESS_NEUTRAL,
  MEMORY_RETRIEVAL_CHARS_PER_TOKEN,
  MEMORY_RETRIEVAL_MS_PER_DAY,
} from './memory-retrieval.constants';
import type { MemoryRetrievalInput } from './memory-retrieval.types';

export type { MemoryRetrievalInput } from './memory-retrieval.types';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Exponential recency-decay: `exp(-λ × Δdays)`.
 * Δdays is floored at 0 so a future-dated timestamp never yields a decay > 1.
 */
function computeRecencyDecay(createdAt: Date, lambda: number): number {
  const deltaMs = Math.max(0, Date.now() - createdAt.getTime());
  return Math.exp(-lambda * (deltaMs / MEMORY_RETRIEVAL_MS_PER_DAY));
}

/**
 * Rough in-process token estimate: `ceil(chars / CHARS_PER_TOKEN)`.
 * Intentionally conservative — tiktoken is not available here without
 * adding a heavy dep.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / MEMORY_RETRIEVAL_CHARS_PER_TOKEN);
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class MemoryRetrievalService {
  private readonly logger = new Logger(MemoryRetrievalService.name);

  constructor(
    private readonly segmentRepo: MemorySegmentCrudRepository,
    private readonly embeddingProvider: EmbeddingProviderService,
    private readonly similarity: EmbeddingSimilarityService,
    private readonly settings: SystemSettingsService,
    /**
     * Optional: when wired, usefulness feedback shifts the composite score.
     * When absent (e.g. in MemorySignalsModule without the feedback service),
     * each segment is treated as having neutral usefulness (0.5).
     */
    @Optional()
    private readonly feedbackService?: MemorySegmentFeedbackService,
  ) {}

  /**
   * Retrieve memory segments relevant to `queryText` within `tokenBudget`.
   *
   * Returns an empty array if no segments exist for the scope.
   * Never throws — all errors are caught and trigger the recency fallback.
   */
  async retrieve(input: MemoryRetrievalInput): Promise<MemorySegment[]> {
    const { queryText, tokenBudget } = input;

    const segments = await this.fetchCandidateSegments(input);
    if (segments.length === 0) {
      return [];
    }

    const mode = await this.resolveMode();
    if (mode === 'recency' || queryText.trim().length === 0) {
      return this.recencyRetrieve(segments, tokenBudget);
    }

    return this.hybridRetrieveWithFallback(segments, queryText, tokenBudget);
  }

  // ── Private: retrieval paths ──────────────────────────────────────────────

  private async hybridRetrieveWithFallback(
    segments: MemorySegment[],
    queryText: string,
    tokenBudget: number,
  ): Promise<MemorySegment[]> {
    try {
      return await this.hybridRetrieve(segments, queryText, tokenBudget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `MemoryRetrievalService: hybrid retrieval failed, falling back to recency. ` +
          `Error: ${message}`,
      );
      return this.recencyRetrieve(segments, tokenBudget);
    }
  }

  private async hybridRetrieve(
    segments: MemorySegment[],
    queryText: string,
    tokenBudget: number,
  ): Promise<MemorySegment[]> {
    // Step 1: verify that an embedding model is configured.
    // EmbeddingProviderService.embed is fail-soft (never throws, returns
    // {configured:false} on any failure) so this is a safe gate check.
    const embedCheck = await this.embeddingProvider.embed([queryText]);
    if (!embedCheck.configured) {
      return this.recencyRetrieve(segments, tokenBudget);
    }

    // Step 2: run scope-filtered KNN + lexical RRF via EmbeddingSimilarityService.
    // Provide the full segment corpus so the lexical arm can score content even
    // for segments that have not yet been embedded (embedding backfill lag).
    const segmentMap = new Map(segments.map((s) => [s.id, s]));
    const ownerIds = segments.map((s) => s.id);
    const corpus = segments.map((s) => ({ ownerId: s.id, content: s.content }));

    const neighbours = await this.similarity.findNearest(
      queryText,
      MEMORY_RETRIEVAL_HYBRID_CANDIDATE_K,
      { ownerType: 'memory_segment', ownerIds, corpus },
    );

    // Step 3: no similarity neighbours → fall back to recency.
    if (neighbours.length === 0) {
      return this.recencyRetrieve(segments, tokenBudget);
    }

    // Step 4: batch-load usefulness feedback for the candidate set.
    const neighbourIds = neighbours
      .map((n) => n.ownerId)
      .filter((id) => segmentMap.has(id));
    const usefulnessMap = await this.resolveUsefulness(neighbourIds);

    // Step 5: compute composite score and re-rank.
    const scored = neighbours
      .map((n) => {
        const segment = segmentMap.get(n.ownerId);
        if (!segment) {
          return null;
        }
        const score = this.computeCompositeScore(
          n.score,
          segment,
          usefulnessMap,
        );
        return { segment, score };
      })
      .filter(
        (entry): entry is { segment: MemorySegment; score: number } =>
          entry !== null,
      );

    scored.sort((a, b) => b.score - a.score);

    return this.trimToTokenBudget(
      scored.map((e) => e.segment),
      tokenBudget,
    );
  }

  private recencyRetrieve(
    segments: MemorySegment[],
    tokenBudget: number,
  ): MemorySegment[] {
    // Segments are already returned in created_at DESC order by the repository.
    return this.trimToTokenBudget(segments, tokenBudget);
  }

  // ── Private: scoring ──────────────────────────────────────────────────────

  /**
   * composite = cosine_rrf_score × recency_decay × usefulness_effective × pinned_boost
   *
   * - `cosine_rrf_score`: the fused score from EmbeddingSimilarityService
   *   (0 = unrelated, higher = more similar).
   * - `recency_decay`: exp(-λ × age_in_days) — rewards fresh segments.
   * - `usefulness_effective`: feedback ratio [0, 1]; null → 0.5 (neutral).
   * - `pinned_boost`: 2× multiplier for operator-pinned segments.
   */
  private computeCompositeScore(
    similarityScore: number,
    segment: MemorySegment,
    usefulnessMap: Map<
      string,
      { usefulness: number | null; sampleSize: number }
    >,
  ): number {
    const recencyDecay = computeRecencyDecay(
      segment.created_at,
      MEMORY_RETRIEVAL_RECENCY_LAMBDA,
    );
    const feedbackEntry = usefulnessMap.get(segment.id);
    const usefulnessValue =
      feedbackEntry?.usefulness ?? MEMORY_RETRIEVAL_USEFULNESS_NEUTRAL;
    const pinnedBoost = segment.pinned ? MEMORY_RETRIEVAL_PINNED_BOOST : 1.0;

    return similarityScore * recencyDecay * usefulnessValue * pinnedBoost;
  }

  // ── Private: data helpers ─────────────────────────────────────────────────

  /**
   * Fetch all non-archived segments for the recall union:
   * `project(scopeId) + global + agent(agentProfileName) + workflow(workflowName)`.
   * The agent / workflow pools are only queried when the caller supplied the
   * matching identity field, so a context without a profile or workflow name
   * can never receive (or leak) scoped segments. The merged pool is re-sorted
   * `created_at DESC` so the recency fallback is fair across pools.
   * The repository defaults to `archived_at IS NULL` so no extra filter needed.
   */
  private async fetchCandidateSegments(
    input: Pick<
      MemoryRetrievalInput,
      'scopeId' | 'agentProfileName' | 'workflowName'
    >,
  ): Promise<MemorySegment[]> {
    const queries: Array<Promise<MemorySegment[]>> = [
      this.segmentRepo.findByEntityType('project', input.scopeId),
      this.segmentRepo.findByEntityType('global'),
    ];
    if (input.agentProfileName) {
      queries.push(
        this.segmentRepo.findByEntityType('agent', input.agentProfileName),
      );
    }
    if (input.workflowName) {
      queries.push(
        this.segmentRepo.findByEntityType('workflow', input.workflowName),
      );
    }
    const pools = await Promise.all(queries);
    return pools
      .flat()
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  private async resolveUsefulness(
    segmentIds: string[],
  ): Promise<Map<string, { usefulness: number | null; sampleSize: number }>> {
    if (!this.feedbackService || segmentIds.length === 0) {
      return new Map();
    }
    try {
      return await this.feedbackService.computeUsefulnessForSegments(
        segmentIds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `MemoryRetrievalService: failed to resolve usefulness, using neutral value. ` +
          `Error: ${message}`,
      );
      return new Map();
    }
  }

  /**
   * Accumulate segments until the cumulative token estimate exceeds the budget.
   * Uses a conservative 4-chars-per-token estimate to avoid heavy dependencies.
   */
  private trimToTokenBudget(
    segments: MemorySegment[],
    tokenBudget: number,
  ): MemorySegment[] {
    const result: MemorySegment[] = [];
    let accumulated = 0;
    for (const segment of segments) {
      const tokens = estimateTokens(segment.content);
      if (accumulated + tokens > tokenBudget) {
        break;
      }
      result.push(segment);
      accumulated += tokens;
    }
    return result;
  }

  private async resolveMode(): Promise<'hybrid' | 'recency'> {
    try {
      const raw = await this.settings.get<unknown>(
        MEMORY_RETRIEVAL_MODE_SETTING,
        MEMORY_RETRIEVAL_MODE_DEFAULT,
      );
      if (raw === 'recency') {
        return 'recency';
      }
    } catch {
      // Silently default to hybrid when the settings service is unavailable.
    }
    return 'hybrid';
  }
}
