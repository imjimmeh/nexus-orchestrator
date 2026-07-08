import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Read-path surface for the nightly `MemoryEvictionReaper`. Mirrors
 * the `findEvictionCandidates` method on the original
 * `MemorySegmentRepository`.
 *
 * The method is query-builder-shaped and does not use the
 * `find({ where })` helper — the `buildReadWhere` helper targets
 * the criteria shape, while this query needs composite time-based
 * filters that are not expressible via TypeORM's criteria DSL.
 */
@Injectable()
export class MemorySegmentEvictionRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Find memory segments that the nightly `MemoryEvictionReaper`
   * should consider for eviction.
   *
   * A row is a candidate when ALL of the following hold:
   *   - `archived_at IS NULL`                  (already-archived
   *     rows are never re-candidates)
   *   - `pinned = false`                       (operators can opt
   *     out)
   *   - `source IS NULL OR source NOT IN (:protectedSources)`
   *                                            (allowlist — e.g.
   *     `learning_candidate`)
   *   - `access_count < :minAccessCount`      (load-bearing rows
   *     are kept)
   *   - the row is "old enough":
   *       - `last_accessed_at IS NOT NULL AND last_accessed_at < :idleCutoff`
   *         (touched before the cutoff → eligible)
   *       - OR (`last_accessed_at IS NULL AND created_at < :idleCutoff`)
   *         (never touched but created before the cutoff →
   *         eligible, treats a missing `last_accessed_at` as
   *         "never read"; defensive against rows created before
   *         the column was added)
   *
   * The candidate list is intentionally unordered; the reaper
   * deletes each row by id and emits one
   * `memory.segment.evicted.v1` event per successful delete. A
   * failure on a single row does not stop the rest of the run —
   * the reaper captures per-row errors in the returned summary.
   *
   * Note: we do not perform the delete in this method. Splitting
   * the candidate query from the delete keeps the reaper's
   * failure semantics (log + continue) outside the SQL surface
   * and lets the reaper collect each row's pre-delete snapshot
   * (id, source, last_accessed_at, access_count) for the event
   * payload.
   *
   * The empty-`protectedSources` branch MUST NOT emit a `source`
   * filter — when no allowlist is configured the reaper falls
   * through to the time-based filter alone.
   */
  async findEvictionCandidates(params: {
    protectedSources: readonly string[];
    minAccessCount: number;
    idleCutoff: Date;
  }): Promise<MemorySegment[]> {
    const { protectedSources, minAccessCount, idleCutoff } = params;
    const cutoffIso = idleCutoff.toISOString();
    const protectedList = [...protectedSources];

    const query = this.repository
      .createQueryBuilder('segment')
      // Already-archived rows are excluded: the eviction reaper
      // and the follow-up decay reaper operate on disjoint sets,
      // and a row the decay reaper has archived must never be
      // picked up by the eviction reaper (it would be a
      // confusing user-facing outcome — the row disappears from
      // `getMemorySegments` via the `archived_at IS NULL` default
      // filter, then suddenly emits an "evicted" event because
      // the eviction reaper re-selected it).
      .where('segment.archived_at IS NULL')
      .andWhere('segment.pinned = false')
      .andWhere('segment.access_count < :minAccessCount', { minAccessCount });

    if (protectedList.length === 0) {
      // No allowlist configured → fall through to the time-based
      // filter alone. We still emit the AND so the SQL stays
      // uniform with the protected-list branch.
      query.andWhere(
        '((segment.last_accessed_at IS NOT NULL AND segment.last_accessed_at < :idleCutoff) OR (segment.last_accessed_at IS NULL AND segment.created_at < :idleCutoff))',
        { idleCutoff: cutoffIso },
      );
    } else {
      query
        .andWhere(
          '(segment.source IS NULL OR segment.source NOT IN (:...protectedSources))',
          { protectedSources: protectedList },
        )
        .andWhere(
          '((segment.last_accessed_at IS NOT NULL AND segment.last_accessed_at < :idleCutoff) OR (segment.last_accessed_at IS NULL AND segment.created_at < :idleCutoff))',
          { idleCutoff: cutoffIso },
        );
    }

    return query.getMany();
  }
}
