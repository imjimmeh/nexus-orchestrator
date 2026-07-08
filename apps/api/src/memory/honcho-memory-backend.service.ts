import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMemorySegment } from '@nexus/core';
import {
  MemoryBackend,
  MemorySegmentMetadata,
  MemorySegmentFilters,
  MemoryType,
} from './memory-backend.types';
import { HonchoClientService } from './honcho-client.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';
import { BackendInstrumentation } from './backend-instrumentation';
import { planHonchoRouting } from './memory-query-planner';
import type { PlannerParams, PlannedCall } from './memory-query-planner.types';

@Injectable()
export class HonchoMemoryBackendService implements MemoryBackend {
  private readonly logger = new Logger(HonchoMemoryBackendService.name);

  constructor(
    private readonly client: HonchoClientService,
    private readonly postgres: PostgresMemoryBackendService,
    private readonly configService: ConfigService,
    private readonly backendInstrumentation: BackendInstrumentation,
  ) {}

  async createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType: MemoryType = 'fact',
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment> {
    // Keep writes compatible while initial rollout is read-focused. Honcho
    // is the user-facing backend for this write call, so the write counter
    // is attributed to `honcho` (not double-counted on `postgres`); the
    // underlying Postgres call increments the postgres counter via the
    // PostgresMemoryBackendService instrumentation.
    return this.backendInstrumentation.recordWrite(
      { backend: 'honcho', operation: 'createMemorySegment' },
      async () =>
        metadata === undefined
          ? await this.postgres.createMemorySegment(
              entityType,
              entityId,
              content,
              memoryType,
            )
          : await this.postgres.createMemorySegment(
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
    const workspaceId = this.resolveWorkspaceId(entityType, entityId);
    const peerId = this.resolvePeerId(entityType, entityId);

    try {
      const segments = await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'getMemorySegments' },
        () =>
          this.client.listPeerMemory({
            workspaceId,
            peerId,
            entityType,
            entityId,
            memoryType: filters?.memory_type,
          }),
      );

      if (segments.length === 0 && this.shouldFallbackOnEmpty()) {
        return await this.backendInstrumentation.recordFallback(
          {
            from: 'honcho',
            to: 'postgres',
            operation: 'getMemorySegments',
          },
          () => this.postgres.getMemorySegments(entityType, entityId, filters),
        );
      }

      return segments;
    } catch (error) {
      // `BackendInstrumentation.recordRead`'s `finally` already recorded
      // the honcho read latency (drift D1 / D2 fix: latency observed on
      // both success and error paths via a single `finally` block,
      // eliminating the legacy double-count that occurred when the
      // HonchoFallback backend re-caught the rethrow).
      if (!this.shouldFallbackOnError()) {
        throw error;
      }

      this.logger.warn(
        `Falling back to postgres memory backend for getMemorySegments(${entityType}:${entityId}): ${(error as Error).message}`,
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
    const plannerParams: PlannerParams = {
      entityType,
      entityId: filters?.entity_id,
      memoryType: filters?.memory_type,
    };
    const planned = planHonchoRouting(plannerParams);
    if (planned !== null) {
      // Honcho HAS a path — delegate to the entity-bound method. The
      // inner method records its own honcho read counter via
      // `BackendInstrumentation.recordRead`; the OUTER `recordFallback`
      // MUST NOT fire on this branch (Drift D8 — see the byType branch
      // below and the planner's top-of-file JSDoc).
      return this.invokePlanned(planned);
    }

    this.logger.warn(
      `Honcho does not support listing memory across entity ids for ${entityType}; falling back to postgres`,
    );
    // Drift D8 — unconditional fallback with no honcho read latency
    // observed (no upstream attempt was made). The outer
    // `recordFallback` records the fallback counter; the inner
    // `passthrough` makes the absence of honcho instrumentation
    // explicit and grep-friendly.
    return this.backendInstrumentation.recordFallback(
      {
        from: 'honcho',
        to: 'postgres',
        operation: 'getMemorySegmentsByType',
      },
      () =>
        this.backendInstrumentation.passthrough(() =>
          this.postgres.getMemorySegmentsByType(entityType, filters),
        ),
    );
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
    const workspaceId = this.resolveWorkspaceId(entityType, entityId);
    const peerId = this.resolvePeerId(entityType, entityId);

    try {
      const segments = await this.backendInstrumentation.recordRead(
        { backend: 'honcho', operation: 'searchMemory' },
        () =>
          this.client.searchPeerMemory({
            workspaceId,
            peerId,
            entityType,
            entityId,
            query,
          }),
      );

      if (segments.length === 0 && this.shouldFallbackOnEmpty()) {
        return await this.backendInstrumentation.recordFallback(
          {
            from: 'honcho',
            to: 'postgres',
            operation: 'searchMemory',
          },
          () => this.postgres.searchMemory(entityType, entityId, query),
        );
      }

      return segments;
    } catch (error) {
      // See `getMemorySegments` for the rationale — latency already
      // observed by `BackendInstrumentation.recordRead`'s `finally`.
      if (!this.shouldFallbackOnError()) {
        throw error;
      }

      this.logger.warn(
        `Falling back to postgres memory backend for searchMemory(${entityType}:${entityId}): ${(error as Error).message}`,
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
    const plannerParams: PlannerParams = {
      entityType,
      entityId: filters?.entity_id,
      query,
      memoryType: filters?.memory_type,
    };
    const planned = planHonchoRouting(plannerParams);
    if (planned !== null) {
      // Honcho HAS a path — delegate to the entity-bound method. See
      // `getMemorySegmentsByType` above for the Drift D8 rationale.
      return this.invokePlanned(planned);
    }

    this.logger.warn(
      `Honcho does not support searching memory across entity ids for ${entityType}; falling back to postgres`,
    );
    // Drift D8 — see `getMemorySegmentsByType` for rationale.
    return this.backendInstrumentation.recordFallback(
      {
        from: 'honcho',
        to: 'postgres',
        operation: 'searchMemoryByType',
      },
      () =>
        this.backendInstrumentation.passthrough(() =>
          this.postgres.searchMemoryByType(entityType, query, filters),
        ),
    );
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

  /**
   * Dispatch a `PlannedCall` returned by `planHonchoRouting` to the
   * matching entity-bound read method on this backend.
   *
   * Mirrors the shape of `MemoryListingService.loadSegments` (M2) but
   * dispatches against `this` (Honcho backend) instead of
   * `this.memoryManager`. The byType methods are intentionally absent
   * from the reachable path: `planHonchoRouting` returns `null` for
   * byType branches (Drift D8 — see `memory-query-planner.ts`). The
   * unreachable byType arms throw a defensive error so an accidental
   * routing regression surfaces loudly rather than silently recursing.
   */
  private invokePlanned(planned: PlannedCall): Promise<IMemorySegment[]> {
    switch (planned.method) {
      case 'searchMemory':
        return this.searchMemory(
          ...(planned.args as Parameters<
            HonchoMemoryBackendService['searchMemory']
          >),
        );
      case 'getMemorySegments':
        return this.getMemorySegments(
          ...(planned.args as Parameters<
            HonchoMemoryBackendService['getMemorySegments']
          >),
        );
      case 'searchMemoryByType':
      case 'getMemorySegmentsByType':
        throw new Error(
          `planHonchoRouting returned a byType method (${planned.method}); the Honcho backend has no path for byType queries and the caller MUST handle the null sentinel — this is a Drift D8 invariant violation.`,
        );
      default: {
        const exhaustive: never = planned.method;
        throw new Error(`Unhandled planner method: ${String(exhaustive)}`);
      }
    }
  }

  private shouldFallbackOnError(): boolean {
    const raw =
      this.configService.get<string>('HONCHO_FALLBACK_ON_ERROR') || 'true';
    return raw.toLowerCase() !== 'false';
  }

  private shouldFallbackOnEmpty(): boolean {
    const raw =
      this.configService.get<string>('HONCHO_FALLBACK_ON_EMPTY') || 'true';
    return raw.toLowerCase() !== 'false';
  }

  private resolvePeerId(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private resolveWorkspaceId(entityType: string, entityId: string): string {
    const strategy =
      this.configService.get<string>('HONCHO_WORKSPACE_STRATEGY') || 'global';
    const defaultWorkspace =
      this.configService.get<string>('HONCHO_DEFAULT_WORKSPACE') || 'nexus';

    if (strategy !== 'per_project') {
      return defaultWorkspace;
    }

    if (entityType === 'Project') {
      return this.normalizeWorkspaceId(`project-${entityId}`);
    }

    return defaultWorkspace;
  }

  private normalizeWorkspaceId(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
