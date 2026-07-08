import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Aggregation surface for `memory_segments`. Mirrors the
 * `countActiveSegmentsBySource` method on the original
 * `MemorySegmentRepository`.
 *
 * The method is query-builder-shaped and does not use the
 * `find({ where })` helper — the aggregation is a raw `SELECT ...
 * GROUP BY` and the `archived_at IS NULL` filter is inlined into
 * the query builder WHERE clause (the filter is unconditional;
 * there is no `includeArchived` opt-in for the gauge).
 */
@Injectable()
export class MemorySegmentAggregationRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Count active memory segments grouped by
   * `metadata_json->>'source'`.
   *
   * Used by `MemoryMetricsRefreshService` to overwrite the
   * `active_segments` gauge on a recurring tick. The query
   * returns one row per distinct source string (the schema
   * stores `source` inside the jsonb `metadata_json` blob —
   * there is no dedicated column). Rows with a missing or
   * non-string source are coalesced to `'unknown'` so the
   * refresh never silently drops data.
   *
   * Archived rows (`archived_at IS NOT NULL`) are excluded
   * from the count so the `active_segments` gauge reflects the
   * candidate set the decay reaper will iterate on, not the
   * entire table. The archived subset has its own auditability
   * story (see the `MemoryDecayReaper` service milestone) and
   * double-counting it would inflate the gauge above the
   * candidate set.
   *
   * Returned counts are non-negative integers (`bigint` from
   * Postgres is normalised to `number` via `Number(row.count)`
   * — the active segments gauge is bounded by the segment
   * table size, well within the safe-integer range).
   */
  async countActiveSegmentsBySource(): Promise<
    Array<{ source: string; count: number }>
  > {
    const rows = await this.repository
      .createQueryBuilder('segment')
      .where('segment.archived_at IS NULL')
      .select(
        "COALESCE(NULLIF(segment.metadata_json ->> 'source', ''), 'unknown')",
        'source',
      )
      .addSelect('COUNT(*)', 'count')
      .groupBy(
        "COALESCE(NULLIF(segment.metadata_json ->> 'source', ''), 'unknown')",
      )
      .getRawMany<{ source: string; count: string | number }>();

    return rows.map((row) => ({
      source: row.source,
      count: typeof row.count === 'string' ? Number(row.count) : row.count,
    }));
  }
}
