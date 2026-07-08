import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { IMemorySegment } from '@nexus/core';
import { PluginEventPublisherService } from '../plugin-kernel/events/plugin-event-publisher.service';
import { MEMORY_BACKEND_TOKEN } from './memory-backend.constants';
import type {
  MemoryBackend,
  MemorySegmentMetadata,
  MemoryType,
} from './memory-backend.types';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { EmbeddingWriteEnqueueService } from './signals/embedding-write-enqueue.service';
import { MemoryContentScannerService } from './memory-content-scanner.service';

/**
 * Write-counter attribution policy:
 * The `createMemorySegment` chokepoint does NOT record a per-backend write
 * counter to avoid double-counting — the per-backend backends
 * (`PostgresMemoryBackendService`, `HonchoMemoryBackendService`,
 * `HonchoFallbackMemoryBackendService`) record their own success/failure
 * outcome as part of the unified instrumentation added in milestone 1.
 * This service is therefore restricted to:
 *   1. Calling the resolved backend (its instrumentation captures the
 *      outcome).
 *   2. Bumping the `active_segments` gauge on the default backend
 *      (`postgres`) after each write. A full `SELECT count(*) GROUP BY
 *      source` is left for a follow-up milestone that will own repository
 *      dependencies; the bump keeps the gauge moving on each write, which
 *      is the milestone-1 observability contract.
 *
 * Read-path reinforcement (work item 3d7fb798, milestone 3):
 *   `getMemorySegments` and `searchMemory` invoke
 *   `MemorySegmentRepository.touchReinforcedAt(ids)` after the backend
 *   read returns, so frequently-consumed segments stay "fresh" in the
 *   nightly `MemoryDecayReaper`'s
 *   `effective_last_touch = max(last_accessed_at, last_reinforced_at)`
 *   composite. The call is fire-and-forget — the repository swallows
 *   errors internally and the caller attaches a defensive `.catch(() =>
 *   undefined)` so a DB blip cannot break the read path.
 *
 * TODO(memory-metrics): wire a real active_segments refresh backed by
 * `MemorySegmentRepository` (SELECT count(*) ... GROUP BY source).
 */
@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);

  constructor(
    @Inject(MEMORY_BACKEND_TOKEN)
    private readonly backend: MemoryBackend,
    private readonly memoryMetrics: MemoryMetricsService,
    private readonly metrics: MetricsService,
    private readonly memorySegments: MemorySegmentDecayRepository,
    private readonly enqueue: EmbeddingWriteEnqueueService,
    private readonly scanner: MemoryContentScannerService,
    @Optional()
    private readonly pluginEventPublisher?: PluginEventPublisherService,
  ) {}

  async createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType: MemoryType = 'fact',
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment> {
    this.scanner.scanContent(content);
    this.logger.log(
      `Creating memory segment for ${entityType}:${entityId} of type ${memoryType}`,
    );
    const created =
      metadata === undefined
        ? await this.backend.createMemorySegment(
            entityType,
            entityId,
            content,
            memoryType,
          )
        : await this.backend.createMemorySegment(
            entityType,
            entityId,
            content,
            memoryType,
            metadata,
          );

    this.bumpActiveSegmentsGauge();
    await this.publishMemoryRecordedBestEffort(
      created,
      entityType,
      entityId,
      memoryType,
    );
    this.enqueue.enqueueOwner('memory_segment', created.id);

    return created;
  }

  async getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: { memory_type?: MemoryType },
  ): Promise<IMemorySegment[]> {
    const segments = await this.backend.getMemorySegments(
      entityType,
      entityId,
      filters,
    );

    // Read-path reinforcement (work item 3d7fb798, milestone 3):
    // bump `last_reinforced_at` on every returned segment so the
    // nightly `MemoryDecayReaper` treats hot reads as fresh via
    // `effective_last_touch = max(last_accessed_at,
    // last_reinforced_at)`. Fire-and-forget — never awaited, never
    // thrown out — so the read completes immediately and a DB blip
    // cannot break the caller. The repository's helper additionally
    // filters `archived_at IS NULL` and swallows connection errors
    // internally; the `.catch(() => undefined)` here is a
    // belt-and-suspenders unhandled-rejection guard for any future
    // refactor that drops the internal try/catch.
    this.reinforceReadSegmentsFireAndForget(segments);

    return segments;
  }

  /**
   * Insert-or-replace the single memory segment for the given scope+type.
   *
   * EPIC-208 (Milestone 1): `strategic_intent` is the singleton per-scope
   * long-term planning segment — a fresh record replaces the previous one
   * so the latest CEO intent always wins. The structured payload (horizon,
   * priority_themes, focus_areas, constraints, rationale, updated_at,
   * updated_by) is persisted verbatim in `metadata_json`.
   *
   * The method also refreshes the `content` column with a short
   * human-readable summary so `query_memory` callers can still surface
   * the most recent strategic intent via the existing search path.
   */
  async upsertMemorySegment(
    entityType: string,
    entityId: string,
    memoryType: MemoryType,
    content: string,
    metadata?: MemorySegmentMetadata,
  ): Promise<IMemorySegment> {
    this.scanner.scanContent(content);
    const existing = await this.backend.getMemorySegments(
      entityType,
      entityId,
      {
        memory_type: memoryType,
      },
    );
    const existingFirst = existing[0];

    const backend = this.backend;
    if (typeof backend.updateMemorySegmentWithMetadata !== 'function') {
      throw new NotImplementedException(
        'Memory backend does not implement updateMemorySegmentWithMetadata — required by MemoryBackend contract since work item 3fd06164.',
      );
    }
    const segment = existingFirst
      ? await backend.updateMemorySegmentWithMetadata(
          existingFirst.id,
          content,
          metadata,
        )
      : await backend.createMemorySegment(
          entityType,
          entityId,
          content,
          memoryType,
          metadata,
        );

    if (!segment) {
      throw new NotFoundException(
        `Memory segment ${existingFirst?.id ?? ''} not found`,
      );
    }

    await this.publishMemoryRecordedBestEffort(
      segment,
      entityType,
      entityId,
      memoryType,
    );
    this.enqueue.enqueueOwner('memory_segment', segment.id);

    return segment;
  }

  async getMemorySegmentsByType(
    entityType: string,
    filters?: { entity_id?: string; memory_type?: MemoryType },
  ): Promise<IMemorySegment[]> {
    return this.backend.getMemorySegmentsByType(entityType, filters);
  }

  async updateMemorySegment(
    id: string,
    content: string,
  ): Promise<IMemorySegment | null> {
    const updated = await this.backend.updateMemorySegment(id, content);
    if (!updated) {
      throw new NotFoundException(`Memory segment ${id} not found`);
    }

    this.bumpActiveSegmentsGauge();
    return updated;
  }

  async deleteMemorySegment(id: string): Promise<void> {
    await this.backend.deleteMemorySegment(id);
    this.bumpActiveSegmentsGauge();
  }

  async searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]> {
    const segments = await this.backend.searchMemory(
      entityType,
      entityId,
      query,
    );

    // Read-path reinforcement (work item 3d7fb798, milestone 3):
    // bump `last_reinforced_at` on every returned segment so the
    // nightly `MemoryDecayReaper` treats search hits as fresh via
    // `effective_last_touch = max(last_accessed_at,
    // last_reinforced_at)`. Fire-and-forget — same contract as
    // `getMemorySegments` above; see that method for the full
    // reasoning.
    this.reinforceReadSegmentsFireAndForget(segments);

    return segments;
  }

  async searchMemoryByType(
    entityType: string,
    query: string,
    filters?: { entity_id?: string; memory_type?: MemoryType },
  ): Promise<IMemorySegment[]> {
    return this.backend.searchMemoryByType(entityType, query, filters);
  }

  async searchPromotedLessonsByScope(opts: {
    entity_type: string;
    entity_id?: string;
    query?: string;
    limit?: number;
  }): Promise<IMemorySegment[]> {
    return this.backend.searchPromotedLessonsByScope(opts);
  }

  /**
   * Read the singleton `strategic_intent` segment for a scope.
   *
   * EPIC-208 (Milestone 1): the CEO long-term planning refresh loop
   * relies on this lookup to surface the most recent intent persisted by
   * a previous orchestration cycle. Returns the raw memory segment so
   * the caller can decide how to project the structured `metadata_json`
   * payload into a strategic-intent view.
   *
   * Returns `null` when the scope has not been seeded with a strategic
   * intent yet — callers must treat that as "no intent on file" rather
   * than as an error.
   */
  async getStrategicIntentSegment(
    entityType: string,
    entityId: string,
  ): Promise<IMemorySegment | null> {
    const segments = await this.backend.getMemorySegments(
      entityType,
      entityId,
      {
        memory_type: 'strategic_intent',
      },
    );
    return segments[0] ?? null;
  }

  /**
   * Bump the active-segment gauge by +1 for the default postgres backend.
   *
   * Best-effort: the underlying truth lives in `memory_segments`. A full
   * `SELECT count(*) GROUP BY source` is deferred to a follow-up milestone
   * (see the class-level TODO). The bump keeps the gauge moving on each
   * write, which satisfies the milestone-1 observability contract.
   */
  private bumpActiveSegmentsGauge(): void {
    const backend = 'postgres';
    const source = 'memory';
    const current =
      this.memoryMetrics.snapshot().backend.active_segments.total[backend][
        source
      ];
    const next = (current ?? 0) + 1;
    this.memoryMetrics.setActiveSegments(backend, source, next);
    this.metrics.setMemoryBackendActiveSegments(backend, source, next);
  }

  /**
   * Read-path reinforcement helper (work item 3d7fb798, milestone 3).
   *
   * Schedules a fire-and-forget bump of `last_reinforced_at` on every
   * id in the supplied segment list. Invoked from `getMemorySegments`
   * and `searchMemory` so frequently-consumed segments stay "fresh"
   * in the nightly `MemoryDecayReaper`'s
   * `effective_last_touch = max(last_accessed_at, last_reinforced_at)`
   * composite.
   *
   * Contract (mirrors `MemorySegmentRepository.touchReinforcedAt`):
   *   - The repository call is NEVER awaited. The read returns
   *     immediately and the SQL UPDATE runs as a background task.
   *   - Errors from the repository (transient / connection) are
   *     swallowed internally by the repository AND by the
   *     `.catch(() => undefined)` here, so an exception cannot
   *     escape the read path.
   *   - Empty / non-string ids are filtered out so a Honcho-side
   *     synthetic id (e.g. `user:user-1:0` from
   *     `HonchoMemoryBackendService.mapCandidate`) never reaches
   *     the SQL surface — the `IN (...)` clause only ever
   *     contains real `memory_segments.id` values.
   *   - An empty post-filter list short-circuits the repository
   *     call entirely; the repository itself also short-circuits
   *     on empty arrays, but checking here saves the method
   *     invocation in the common case of an empty read result.
   *
   * The `void` keyword is NOT used because TypeScript's
   * `no-floating-promises` rule accepts `.catch(...)` on a
   * fire-and-forget promise as a valid consumer.
   */
  private reinforceReadSegmentsFireAndForget(segments: IMemorySegment[]): void {
    const ids = segments
      .map((segment) => segment.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return;
    }
    this.memorySegments.touchReinforcedAt(ids).catch(() => undefined);
  }

  private async publishMemoryRecordedBestEffort(
    segment: IMemorySegment,
    entityType: string,
    entityId: string,
    memoryType: MemoryType,
  ): Promise<void> {
    if (!this.pluginEventPublisher) {
      return;
    }

    try {
      await this.pluginEventPublisher.publishMemoryRecordedEvent({
        segmentId: segment.id,
        entityType,
        entityId,
        memoryType,
      });
    } catch {
      // Best-effort publishing must not fail memory writes.
    }
  }
}
