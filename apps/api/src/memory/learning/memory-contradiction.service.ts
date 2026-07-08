import { Inject, Injectable, Logger } from '@nestjs/common';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import {
  CANDIDATE_SIMILARITY,
  type ICandidateSimilarity,
} from '../signals/candidate-similarity.interface';
import { detectOpposingStance } from './memory-contradiction.stance';
import { decideContradiction } from './memory-contradiction.decide';
import {
  MEMORY_CONTRADICTION_ENABLED_SETTING,
  MEMORY_CONTRADICTION_MODE_SETTING,
  MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_SETTING,
  MEMORY_CONTRADICTION_ENABLED_DEFAULT,
  MEMORY_CONTRADICTION_MODE_DEFAULT,
  MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_DEFAULT,
  coerceMemoryContradictionEnabled,
  coerceMemoryContradictionMode,
  coerceMemoryContradictionSimilarityThreshold,
} from '../../settings/memory-contradiction.settings.constants';
import type {
  ContradictionDecision,
  ContradictionEvaluationInput,
  ContradictionMode,
  OpposingStance,
} from './memory-contradiction.types';

/** The owner-type the `memory_embeddings` vector rows use for segments. */
const MEMORY_SEGMENT_OWNER_TYPE = 'memory_segment';

/** Number of nearest neighbours to fetch before picking the top candidate. */
const NEAR_K = 5;

/** An inert, side-effect-free decision returned on the disabled / error path. */
function inert(reason: string): ContradictionDecision {
  return { kind: 'none', reason, similarity: 0 };
}

/**
 * Detect a newly-promoted memory that contradicts an existing in-scope memory
 * and supersede / version it instead of leaving two live contradictory rows
 * (EPIC-212 Phase-3 Task 5).
 *
 * Gated by `memory_contradiction_enabled` (default `false`) and shadow-first
 * via `memory_contradiction_mode` (default `shadow`). With the flag off the
 * service is a no-op — no vector search, no event, no mutation — so the
 * promotion path is byte-identical to Phase-2. The whole evaluation is
 * fail-soft: any error degrades to an inert `none` so a contradiction failure
 * can never break promotion.
 */
@Injectable()
export class MemoryContradictionService {
  private readonly logger = new Logger(MemoryContradictionService.name);

  constructor(
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly settings: SystemSettingsService,
  ) {}

  /**
   * Convenience hook for the auto-promotion path: map a freshly-created memory
   * segment onto the evaluation input. Never throws — it delegates to the
   * fail-soft {@link evaluate}, so the promotion path stays unaffected by any
   * contradiction failure.
   */
  evaluateCreatedSegment(segment: {
    id: string;
    content: string;
    entity_type: string;
    entity_id: string;
    version: number;
  }): Promise<ContradictionDecision> {
    return this.evaluate({
      segmentId: segment.id,
      content: segment.content,
      scopeType: segment.entity_type,
      scopeId: segment.entity_id,
      version: segment.version,
    });
  }

  async evaluate(
    input: ContradictionEvaluationInput,
  ): Promise<ContradictionDecision> {
    try {
      const enabled = coerceMemoryContradictionEnabled(
        await this.settings.get(
          MEMORY_CONTRADICTION_ENABLED_SETTING,
          MEMORY_CONTRADICTION_ENABLED_DEFAULT,
        ),
      );
      if (!enabled) {
        return inert('disabled');
      }

      const decision = await this.detect(input);
      if (decision.kind === 'none') {
        return decision;
      }

      const mode = coerceMemoryContradictionMode(
        await this.settings.get(
          MEMORY_CONTRADICTION_MODE_SETTING,
          MEMORY_CONTRADICTION_MODE_DEFAULT,
        ),
      );

      const applied = mode === 'enforce' && decision.kind !== 'ambiguous';
      await this.emitDetected(input, decision, mode, applied);
      if (applied) {
        await this.applyDecision(input, decision);
      }
      return decision;
    } catch (error) {
      this.logger.warn(
        `contradiction evaluation failed for segment ${input.segmentId} ` +
          `(treating as no-contradiction): ${String(error)}`,
      );
      return inert('error');
    }
  }

  // ── Detection (vector recall + pure stance) ───────────────────────────────

  private async detect(
    input: ContradictionEvaluationInput,
  ): Promise<ContradictionDecision> {
    const candidates = await this.memorySegments.findByEntity(
      input.scopeType,
      input.scopeId,
    );
    const others = candidates.filter(
      (candidate) =>
        candidate.id !== input.segmentId && candidate.superseded_by == null,
    );
    if (others.length === 0) {
      return inert('no_scope_candidates');
    }

    const threshold = coerceMemoryContradictionSimilarityThreshold(
      await this.settings.get(
        MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_SETTING,
        MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD_DEFAULT,
      ),
    );

    // FU-2 carry-forward: this gate compares an RRF-fused score (rank-based,
    // max ~0.033 when both similarity arms are non-empty) against a cosine-scale
    // threshold, the same latent bug the dedup callers were migrated off of. It
    // is deliberately NOT yet moved to `findRawSimilarNeighbors` because
    // MEMORY_CONTRADICTION_SIMILARITY_THRESHOLD may have been tuned against fused
    // magnitude — verify (and likely re-tune) its intended scale before migrating.
    const neighbours = await this.similarity.findNearest(
      input.content,
      NEAR_K,
      {
        ownerType: MEMORY_SEGMENT_OWNER_TYPE,
        ownerIds: others.map((candidate) => candidate.id),
        corpus: others.map((candidate) => ({
          ownerId: candidate.id,
          content: candidate.content,
        })),
      },
    );

    const top = neighbours[0];
    const nearest =
      top === undefined ? null : { ownerId: top.ownerId, score: top.score };
    if (nearest === null || nearest.score < threshold) {
      return decideContradiction({
        nearest,
        stance: null,
        thresholds: { similarityThreshold: threshold },
      });
    }

    const existing = others.find(
      (candidate) => candidate.id === nearest.ownerId,
    );
    const stance = await this.resolveStance(
      input.content,
      existing?.content ?? '',
    );

    return decideContradiction({
      nearest,
      stance,
      thresholds: { similarityThreshold: threshold },
    });
  }

  /**
   * Pure deterministic stance heuristic, escalating ONLY an `ambiguous` verdict
   * to a bounded LLM confirm. The confirm is currently a fail-soft stub that
   * returns `ambiguous` (carry-forward: wire a bounded analyst confirm) so a
   * near-but-unclear hit always surfaces as an operator diff and never silently
   * supersedes either row.
   */
  private async resolveStance(
    newContent: string,
    existingContent: string,
  ): Promise<OpposingStance> {
    const stance = detectOpposingStance(newContent, existingContent);
    if (stance !== 'ambiguous') {
      return stance;
    }
    return this.confirmAmbiguousStance(newContent, existingContent);
  }

  /**
   * Bounded LLM confirm seam for an ambiguous stance. STUB (Phase-3 Task 5
   * carry-forward): returns `ambiguous` so the deterministic heuristic fully
   * drives behaviour today. Fail-soft by contract — a future LLM confirm must
   * degrade to `ambiguous` on any error.
   */
  private confirmAmbiguousStance(
    _newContent: string,
    _existingContent: string,
  ): Promise<OpposingStance> {
    return Promise.resolve('ambiguous');
  }

  // ── Apply (enforce-mode mutation; archive-only, recoverable) ──────────────

  private async applyDecision(
    input: ContradictionEvaluationInput,
    decision: ContradictionDecision,
  ): Promise<void> {
    const existingId = decision.existingSegmentId;
    if (existingId === undefined) {
      return;
    }

    if (decision.kind === 'supersede') {
      await this.memorySegments.update(input.segmentId, {
        supersedes: existingId,
      });
      await this.memorySegments.update(existingId, {
        superseded_by: input.segmentId,
        archived_at: new Date(),
      });
      return;
    }

    if (decision.kind === 'version') {
      await this.memorySegments.update(input.segmentId, {
        supersedes: existingId,
        version: input.version + 1,
      });
    }
  }

  // ── Observability (best-effort) ───────────────────────────────────────────

  private emitDetected(
    input: ContradictionEvaluationInput,
    decision: ContradictionDecision,
    mode: ContradictionMode,
    applied: boolean,
  ): Promise<void> {
    return this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.memoryContradictionDetected,
      outcome: 'success',
      payload: {
        new_segment_id: input.segmentId,
        existing_segment_id: decision.existingSegmentId,
        scope_type: input.scopeType,
        scope_id: input.scopeId,
        kind: decision.kind,
        reason: decision.reason,
        similarity: decision.similarity,
        mode,
        applied,
      },
    });
  }
}
