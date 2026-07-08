import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Repository methods tied to the `learning_candidate` source
 * surface on `memory_segments`. Mirrors the
 * `findLearningCandidateSegment`, `findPromotedSegmentsByScope`,
 * `countPromotedSegmentsCreatedSince`, and
 * `findProvisionalPastProbation` methods on the original
 * `MemorySegmentRepository`.
 *
 * Note: `findLearningCandidateSegment` is intentionally exempt
 * from `buildReadWhere` — the promotion-write hot path needs to
 * surface an archived candidate so the caller can react (re-promote,
 * skip, etc.). Mirroring a `null` for an archived row would be a
 * silent correctness bug.
 */
@Injectable()
export class MemorySegmentLearningCandidateRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Intentionally exempt from the `archived_at IS NULL` default —
   * see the class JSDoc.
   */
  async findLearningCandidateSegment(
    entity_type: string,
    entity_id: string,
    learningCandidateId: string,
  ): Promise<MemorySegment | null> {
    return this.repository
      .createQueryBuilder('segment')
      .where('segment.entity_type = :entityType', { entityType: entity_type })
      .andWhere('segment.entity_id = :entityId', { entityId: entity_id })
      .andWhere('segment.memory_type = :memoryType', { memoryType: 'fact' })
      .andWhere("segment.metadata_json ->> 'source' = :source", {
        source: 'learning_candidate',
      })
      .andWhere(
        "segment.metadata_json ->> 'learning_candidate_id' = :learningCandidateId",
        { learningCandidateId },
      )
      .orderBy('segment.created_at', 'DESC')
      .getOne();
  }

  async findPromotedSegmentsByScope(opts: {
    entity_type: string;
    entity_id?: string;
    query?: string;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<MemorySegment[]> {
    const limit = opts.limit ?? 25;
    const queryBuilder = this.repository
      .createQueryBuilder('seg')
      .where('seg.entity_type = :entityType', { entityType: opts.entity_type })
      .andWhere("seg.metadata_json ->> 'source' = :src", {
        src: 'learning_candidate',
      })
      .andWhere("seg.memory_type = 'fact'")
      .orderBy('seg.updated_at', 'DESC')
      .limit(limit);

    if (opts.entity_id) {
      queryBuilder.andWhere('seg.entity_id = :entityId', {
        entityId: opts.entity_id,
      });
    }

    if (opts.query && opts.query.trim().length > 0) {
      queryBuilder.andWhere('seg.content ILIKE :q', {
        q: `%${opts.query.trim()}%`,
      });
    }

    if (!opts.includeArchived) {
      // Default to the "active" set — promoted segments that have
      // been archived by the MemoryDecayReaper should NOT surface
      // in scope listings unless the caller explicitly opts in.
      queryBuilder.andWhere('seg.archived_at IS NULL');
    }

    return queryBuilder.getMany();
  }

  /**
   * Count promoted-learning segments created at/after `windowStart`
   * (EPIC-212 Phase 3, Task 6, cost-per-promoted-memory
   * denominator). A promoted lesson is a
   * `metadata_json.source = 'learning_candidate'` segment; archived
   * rows still count (they were promoted in the window).
   *
   * Note: this method does NOT apply the `archived_at IS NULL`
   * filter — archived rows that were promoted in the window still
   * count toward the denominator. The window is anchored on
   * `created_at` so an archived-then-promoted-in-window row is
   * counted exactly once.
   */
  async countPromotedSegmentsCreatedSince(windowStart: Date): Promise<number> {
    return this.repository
      .createQueryBuilder('segment')
      .where("segment.metadata_json ->> 'source' = :src", {
        src: 'learning_candidate',
      })
      .andWhere('segment.created_at >= :windowStart', { windowStart })
      .getCount();
  }

  /**
   * Find promoted learning_candidate fact segments created at/after
   * `since`, system-wide (no `entity_type` / `entity_id` filter) for
   * the self-improvement control plane `PromotedLessonsCard`. The
   * control plane renders a system-wide, time-anchored "lessons
   * promoted in the last N units" view, so the scope pair that
   * {@link findPromotedSegmentsByScope} gates on is intentionally
   * dropped here. Defaults mirror that route: archived rows are
   * hidden unless the caller opts in via `includeArchived: true`, and
   * `limit` falls back to 50 (the route's `since` window cap).
   *
   * Filter contract:
   *   - `metadata_json ->> 'source' = 'learning_candidate'` —
   *     distinguishes the promoted-lesson surface from other
   *     `memory_type='fact'` rows (postmortems, preferences, etc.).
   *   - `memory_type = 'fact'` — mirrors the promotion write path;
   *     promoted lessons are always written as fact segments.
   *   - `created_at >= :since` — anchors the listing to a wall-clock
   *     window produced by the caller's `since` parser (default 7
   *     days). `created_at` is chosen over `updated_at` so a
   *     re-evaluated / re-promoted row is counted once per the
   *     original promotion wall-clock time.
   *   - `archived_at IS NULL` (default) — hidden by default; the
   *     reaper's archive stamp must not surface a "promoted in
   *     window" row that is no longer live.
   *
   * Ordering: `created_at DESC` so the freshest promotion wins the
   * top slot on the card.
   */
  async listPromotedSegmentsAfter(opts: {
    since: Date;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<MemorySegment[]> {
    const limit = opts.limit ?? 50;
    const queryBuilder = this.repository
      .createQueryBuilder('segment')
      .where("segment.metadata_json ->> 'source' = :src", {
        src: 'learning_candidate',
      })
      .andWhere("segment.memory_type = 'fact'")
      .andWhere('segment.created_at >= :since', { since: opts.since })
      .orderBy('segment.created_at', 'DESC')
      .limit(limit);

    if (!opts.includeArchived) {
      queryBuilder.andWhere('segment.archived_at IS NULL');
    }

    return queryBuilder.getMany();
  }

  /**
   * Find provisional auto-promotions whose probation window has
   * elapsed (EPIC-212 Phase-3 Task 7). The
   * `MemoryProbationEvaluatorService` confirms or reverts each
   * returned row.
   *
   * A row qualifies when ALL hold:
   *   - `governance_state = 'provisional'` — only auto-promotions
   *     still on probation are evaluated. `confirmed` and legacy
   *     `NULL` rows are never selected (the evaluator must not
   *     touch settled or pre-governance rows).
   *   - `archived_at IS NULL` — an already-archived row (decayed,
   *     evicted, or superseded) is never re-evaluated.
   *   - `(metadata_json ->> 'probation_until')::timestamptz < now`
   *     — the probation window stamped by
   *     `PromotionGovernancePolicyService` has elapsed. Rows with
   *     no / unparseable `probation_until` are excluded by the cast
   *     comparison (a `NULL` extraction compares as `NULL` /
   *     false).
   */
  async findProvisionalPastProbation(now: Date): Promise<MemorySegment[]> {
    return this.repository
      .createQueryBuilder('segment')
      .where('segment.governance_state = :state', { state: 'provisional' })
      .andWhere('segment.archived_at IS NULL')
      .andWhere(
        "(segment.metadata_json ->> 'probation_until')::timestamptz < :now::timestamptz",
        { now: now.toISOString() },
      )
      .getMany();
  }
}
