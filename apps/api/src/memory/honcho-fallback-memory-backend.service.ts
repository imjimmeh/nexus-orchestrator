import { Injectable, Logger } from '@nestjs/common';
import { IMemorySegment } from '@nexus/core';
import {
  MemoryBackend,
  MemorySegmentMetadata,
  MemorySegmentFilters,
  MemoryType,
} from './memory-backend.types';
import { HonchoMemoryBackendService } from './honcho-memory-backend.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';
import { BackendInstrumentation } from './backend-instrumentation';

/**
 * Honcho backend with unconditional PostgreSQL fallback.
 *
 * Distinct from {@link HonchoMemoryBackendService} ("honcho" mode):
 * - `honcho` mode: respects the `HONCHO_FALLBACK_ON_ERROR` env var
 * - `honcho-fallback` mode (this class): always falls back to PostgreSQL on
 *   any read error, regardless of `HONCHO_FALLBACK_ON_ERROR`
 *
 * Use this mode when you want Honcho for reads but need a guaranteed
 * safe fallback during a migration or early rollout.
 *
 * Selected via MEMORY_BACKEND=dual in the environment.
 *
 * Observability: each catch block delegates to
 * `BackendInstrumentation.recordFallback` so the dual-write fallback
 * counter (`memoryBackendFallbackTotal`) fires through the same helper
 * that the rest of the memory module uses. The primary honcho read
 * latency is observed by `BackendInstrumentation.recordRead`'s
 * `finally` block — drift D2 from the design doc is resolved by NOT
 * re-recording the primary latency in this class's catch (the
 * underlying `HonchoMemoryBackendService.recordRead` already handles
 * exactly-once observation).
 */
@Injectable()
export class HonchoFallbackMemoryBackendService implements MemoryBackend {
  private readonly logger = new Logger(HonchoFallbackMemoryBackendService.name);

  constructor(
    private readonly honcho: HonchoMemoryBackendService,
    private readonly postgres: PostgresMemoryBackendService,
    private readonly backendInstrumentation: BackendInstrumentation,
  ) {}

  async createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType: MemoryType = 'fact',
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment> {
    // Writes always go through Postgres in this mode; record a write for
    // `honcho` (the user-facing backend) and let the postgres call record
    // its own write counter via PostgresMemoryBackendService. The helper's
    // `recordWrite` `try / catch` preserves the legacy success/failure
    // split and re-throws on failure.
    return this.backendInstrumentation.recordWrite(
      { backend: 'honcho', operation: 'createMemorySegment' },
      () =>
        metadata === undefined
          ? this.postgres.createMemorySegment(
              entityType,
              entityId,
              content,
              memoryType,
            )
          : this.postgres.createMemorySegment(
              entityType,
              entityId,
              content,
              memoryType,
              metadata,
            ),
    );
  }

  async getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      // The helper's `recordRead` `finally` block fires the honcho read
      // latency observation exactly once — drift D1 fix (latency
      // observed on success AND failure) and drift D2 fix (no
      // double-count when the delegated `HonchoMemoryBackendService`
      // re-throws after its own catch).
      return await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'getMemorySegments' },
        () => this.honcho.getMemorySegments(entityType, entityId, filters),
      );
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for getMemorySegments(${entityType}:${entityId}): ${(error as Error).message}`,
      );
      return await this.backendInstrumentation.recordFallback(
        {
          from: 'honcho',
          to: 'postgres',
          operation: 'getMemorySegments',
        },
        () => this.postgres.getMemorySegments(entityType, entityId, filters),
      );
    }
  }

  async getMemorySegmentsByType(
    entityType: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'getMemorySegmentsByType' },
        () => this.honcho.getMemorySegmentsByType(entityType, filters),
      );
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for getMemorySegmentsByType(${entityType}): ${(error as Error).message}`,
      );
      return await this.backendInstrumentation.recordFallback(
        {
          from: 'honcho',
          to: 'postgres',
          operation: 'getMemorySegmentsByType',
        },
        () => this.postgres.getMemorySegmentsByType(entityType, filters),
      );
    }
  }

  async updateMemorySegment(
    id: string,
    content: string,
  ): Promise<IMemorySegment | null> {
    return this.postgres.updateMemorySegment(id, content);
  }

  async updateMemorySegmentWithMetadata(
    id: string,
    content: string,
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment | null> {
    return this.postgres.updateMemorySegmentWithMetadata(id, content, metadata);
  }

  async deleteMemorySegment(id: string): Promise<void> {
    await this.postgres.deleteMemorySegment(id);
  }

  async searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'searchMemory' },
        () => this.honcho.searchMemory(entityType, entityId, query),
      );
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for searchMemory(${entityType}:${entityId}): ${(error as Error).message}`,
      );
      return await this.backendInstrumentation.recordFallback(
        {
          from: 'honcho',
          to: 'postgres',
          operation: 'searchMemory',
        },
        () => this.postgres.searchMemory(entityType, entityId, query),
      );
    }
  }

  async searchMemoryByType(
    entityType: string,
    query: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'searchMemoryByType' },
        () => this.honcho.searchMemoryByType(entityType, query, filters),
      );
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for searchMemoryByType(${entityType}): ${(error as Error).message}`,
      );
      return await this.backendInstrumentation.recordFallback(
        {
          from: 'honcho',
          to: 'postgres',
          operation: 'searchMemoryByType',
        },
        () => this.postgres.searchMemoryByType(entityType, query, filters),
      );
    }
  }

  async searchPromotedLessonsByScope(opts: {
    entity_type: string;
    entity_id?: string;
    query?: string;
    limit?: number;
  }): Promise<IMemorySegment[]> {
    // Honcho does not model the `learning_candidate` provenance metadata we
    // attach on promotion, so list promoted lessons from postgres directly.
    return this.postgres.searchPromotedLessonsByScope(opts);
  }
}
