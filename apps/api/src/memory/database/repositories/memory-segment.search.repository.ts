import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, type Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';
import { buildReadWhere } from './memory-segment.repository.helpers';

/**
 * Substring-search surface for `memory_segments`. Mirrors the
 * `search` and `searchByEntityType` methods on the original
 * `MemorySegmentRepository`.
 *
 * Both methods default to `archived_at IS NULL` (delegated to
 * `buildReadWhere`) — the nightly `MemoryDecayReaper` archives a
 * row when its decayed confidence falls below the configured
 * floor, and decayed rows must not surface in default searches
 * (`MemoryManagerService.searchMemory`). Callers that explicitly
 * need to surface archived rows can opt in via
 * `{ includeArchived: true }`.
 *
 * The `Like('%query%')` substring shape is preserved verbatim
 * from the original — it is the documented contract of
 * `MemoryManagerService.searchMemory` and switching to a full-text
 * index would change behaviour for callers that pass raw query
 * strings containing SQL LIKE wildcards.
 */
@Injectable()
export class MemorySegmentSearchRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  async search(
    entity_type: string,
    entity_id: string,
    query: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment[]> {
    return this.repository.find({
      where: buildReadWhere(
        {
          entity_type,
          entity_id,
          content: Like(`%${query}%`),
        },
        options.includeArchived ?? false,
      ),
      order: { created_at: 'DESC' },
    });
  }

  async searchByEntityType(
    entity_type: string,
    query: string,
    entity_id?: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment[]> {
    return this.repository.find({
      where: buildReadWhere(
        entity_id
          ? {
              entity_type,
              entity_id,
              content: Like(`%${query}%`),
            }
          : {
              entity_type,
              content: Like(`%${query}%`),
            },
        options.includeArchived ?? false,
      ),
      order: { created_at: 'DESC' },
    });
  }
}
