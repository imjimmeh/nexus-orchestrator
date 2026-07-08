import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { MemorySegment } from '../entities/memory-segment.entity';
import { buildReadWhere } from './memory-segment.repository.helpers';

/**
 * CRUD-shaped read/write surface for `memory_segments`. Mirrors the
 * original `MemorySegmentRepository` 1:1 so the consumer-side
 * refactor (a later milestone) can swap the dependency without
 * changing the call shape.
 *
 * Read methods default to `archived_at IS NULL` (delegated to
 * `buildReadWhere`) — the nightly `MemoryDecayReaper` archives a
 * row by setting `archived_at` when its decayed confidence falls
 * below the configured floor, and those rows must not leak into
 * default reads (`getMemorySegments`, `searchMemory`, etc.).
 * Callers that explicitly need to surface archived rows can opt
 * in via `{ includeArchived: true }`.
 *
 * Implementation note: the project does NOT use TypeORM
 * `@DeleteDateColumn` — mirroring the explicit
 * `archived_at: IsNull()` + opt-in pattern keeps the soft-archive
 * semantics uniform across domains and avoids the implicit global
 * filter that `@DeleteDateColumn` would force on every read.
 */
@Injectable()
export class MemorySegmentCrudRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  async findAll(
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment[]> {
    return this.repository.find({
      where: buildReadWhere(undefined, options.includeArchived ?? false),
    });
  }

  async findById(
    id: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment | null> {
    return this.repository.findOne({
      where: buildReadWhere({ id }, options.includeArchived ?? false),
    });
  }

  async findByEntity(
    entity_type: string,
    entity_id: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment[]> {
    return this.repository.find({
      where: buildReadWhere(
        { entity_type, entity_id },
        options.includeArchived ?? false,
      ),
      order: { created_at: 'DESC' },
    });
  }

  async findByEntityType(
    entity_type: string,
    entity_id?: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<MemorySegment[]> {
    return this.repository.find({
      where: buildReadWhere(
        entity_id ? { entity_type, entity_id } : { entity_type },
        options.includeArchived ?? false,
      ),
      order: { created_at: 'DESC' },
    });
  }

  async create(data: Partial<MemorySegment>): Promise<MemorySegment> {
    const segment = this.repository.create(data);
    return this.repository.save(segment);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<MemorySegment>,
  ): Promise<MemorySegment | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  /**
   * Save a fully-mutated `MemorySegment` entity. Used by the
   * `MemoryDecayReaper` (work item 3d7fb798) when it needs to
   * update the `metadata_json.confidence` key on a row — the
   * `update(id, partial)` shape's `QueryDeepPartialEntity`
   * constraint is too strict for a `Record<string, unknown>`
   * value, so the reaper loads the row, mutates the metadata
   * blob in place, and calls this method to persist the
   * full entity.
   *
   * The method is intentionally narrow: callers MUST pass a
   * `MemorySegment` they loaded through one of the repository's
   * read methods so the `updated_at` writeback (TypeORM's
   * `@UpdateDateColumn`) and the entity's lifecycle hooks fire
   * as expected.
   */
  async save(segment: MemorySegment): Promise<MemorySegment> {
    return this.repository.save(segment);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
