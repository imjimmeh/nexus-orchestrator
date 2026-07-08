import { IsNull, type FindOptionsWhere } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';

/**
 * Shared WHERE-clause builder for the read methods on the per-intent
 * `memory-segment.*.repository` classes.
 *
 * Read methods on the original `MemorySegmentRepository` default to
 * hiding archived segments (the nightly `MemoryDecayReaper` sets
 * `archived_at` when a segment's decayed confidence falls below the
 * configured floor — those rows are preserved for auditability but
 * should NOT leak into default reads). Callers that explicitly need
 * to surface archived rows can opt-in via `includeArchived: true`.
 *
 * Centralising the merge here keeps the SQL surface uniform across
 * read methods and makes it impossible to forget the filter on a
 * new method. The `IsNull` helper is the canonical TypeORM way to
 * express `WHERE archived_at IS NULL` in a `find({ where })` clause
 * and integrates with the partial index
 * `idx_memory_segments_archived_at` the migration added.
 */
export function buildReadWhere(
  base: FindOptionsWhere<MemorySegment> | undefined,
  includeArchived: boolean,
): FindOptionsWhere<MemorySegment> {
  if (includeArchived) return base ?? {};
  return { ...(base ?? {}), archived_at: IsNull() };
}
