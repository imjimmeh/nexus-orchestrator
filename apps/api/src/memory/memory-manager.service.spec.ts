import { vi } from 'vitest';
import type { Mocked, MockedFunction } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PluginEventPublisherService } from '../plugin-kernel/events/plugin-event-publisher.service';
import { MemoryManagerService } from './memory-manager.service';
import { MEMORY_BACKEND_TOKEN } from './memory-backend.constants';
import { MemoryBackend } from './memory-backend.types';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { EmbeddingWriteEnqueueService } from './signals/embedding-write-enqueue.service';
import { MemoryContentScannerService } from './memory-content-scanner.service';

function createMetricsStubs() {
  return {
    recordBackendRead: vi.fn(),
    recordBackendWrite: vi.fn(),
    recordBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
    setActiveSegments: vi.fn(),
    snapshot: vi.fn(() => ({
      backend: {
        read: { total: { postgres: 0, honcho: 0 }, latency_ms: {} },
        write: {
          total: {
            postgres: { success: 0, failure: 0 },
            honcho: { success: 0, failure: 0 },
          },
        },
        active_segments: { total: { postgres: {}, honcho: {} } },
        fallback: {},
      },
      distillation: { completed_total: { success: 0, failure: 0 }, last: null },
      learning: { promoted_total: 0, last_promoted: null },
      generated_at: new Date().toISOString(),
    })),
  } as unknown as MemoryMetricsService;
}

function createPromStubs() {
  return {
    recordMemoryBackendRead: vi.fn(),
    recordMemoryBackendWrite: vi.fn(),
    setMemoryBackendActiveSegments: vi.fn(),
    recordMemoryBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
  } as unknown as MetricsService;
}

interface MockMemorySegmentRepository {
  touchReinforcedAt: ReturnType<typeof vi.fn<(ids: string[]) => Promise<void>>>;
}

function createMemorySegmentRepoStub(): MockMemorySegmentRepository {
  return {
    // Resolves to undefined by default so the caller's
    // `.catch(() => undefined)` never fires under normal test
    // conditions. Individual tests can override this with
    // `mockRejectedValue(...)` to exercise the fire-and-forget
    // swallow path, or with `mockImplementationOnce(...)` to
    // pin a controlled-promise return.
    //
    // The explicit `vi.fn<(ids: string[]) => Promise<void>>()`
    // signature is required: the helper is typed as
    // `Promise<void>` (not `void`) so `mockImplementationOnce`
    // accepts a function returning a Promise without tripping
    // `@typescript-eslint/no-misused-promises`. Without the
    // generic, `mockResolvedValue(undefined)` infers R=`void`
    // and the implementation must be synchronous.
    touchReinforcedAt: vi
      .fn<(ids: string[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

describe('MemoryManagerService', () => {
  let service: MemoryManagerService;
  let mockBackend: Mocked<MemoryBackend>;
  let createMemorySegment: MockedFunction<MemoryBackend['createMemorySegment']>;
  let updateMemorySegmentWithMetadata: MockedFunction<
    MemoryBackend['updateMemorySegmentWithMetadata']
  >;
  let searchMemory: MockedFunction<MemoryBackend['searchMemory']>;
  let searchMemoryByType: MockedFunction<MemoryBackend['searchMemoryByType']>;
  let searchPromotedLessonsByScope: MockedFunction<
    MemoryBackend['searchPromotedLessonsByScope']
  >;
  let memoryMetrics: ReturnType<typeof createMetricsStubs>;
  let promMetrics: ReturnType<typeof createPromStubs>;
  let pluginEventPublisher: Mocked<
    Pick<PluginEventPublisherService, 'publishMemoryRecordedEvent'>
  >;
  let memorySegmentRepo: MockMemorySegmentRepository;

  beforeEach(async () => {
    createMemorySegment = vi.fn().mockResolvedValue({
      id: 'uuid',
      entity_type: 'User',
      entity_id: 'u1',
      content: 'content',
      memory_type: 'fact',
      version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });
    searchMemory = vi.fn().mockResolvedValue([]);
    searchMemoryByType = vi.fn().mockResolvedValue([]);
    searchPromotedLessonsByScope = vi.fn().mockResolvedValue([]);
    updateMemorySegmentWithMetadata = vi.fn().mockResolvedValue({
      id: 'uuid',
      entity_type: 'User',
      entity_id: 'u1',
      content: 'updated',
      memory_type: 'fact',
      version: 2,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockBackend = {
      createMemorySegment,
      getMemorySegments: vi.fn().mockResolvedValue([]),
      getMemorySegmentsByType: vi.fn().mockResolvedValue([]),
      updateMemorySegment: vi.fn().mockResolvedValue({
        id: 'uuid',
        entity_type: 'User',
        entity_id: 'u1',
        content: 'updated',
        memory_type: 'fact',
        version: 2,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      updateMemorySegmentWithMetadata,
      deleteMemorySegment: vi.fn().mockResolvedValue(undefined),
      searchMemory,
      searchMemoryByType,
      searchPromotedLessonsByScope,
    };
    pluginEventPublisher = {
      publishMemoryRecordedEvent: vi.fn().mockResolvedValue({
        ok: true,
        topic: 'memory.recorded.v1',
        deliveries: [],
      }),
    };
    memoryMetrics = createMetricsStubs();
    promMetrics = createPromStubs();
    memorySegmentRepo = createMemorySegmentRepoStub();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryManagerService,
        {
          provide: MEMORY_BACKEND_TOKEN,
          useValue: mockBackend,
        },
        {
          provide: PluginEventPublisherService,
          useValue: pluginEventPublisher,
        },
        {
          provide: MemoryMetricsService,
          useValue: memoryMetrics,
        },
        {
          provide: MetricsService,
          useValue: promMetrics,
        },
        {
          provide: MemorySegmentDecayRepository,
          useValue: memorySegmentRepo,
        },
        {
          provide: EmbeddingWriteEnqueueService,
          useValue: { enqueueOwner: vi.fn() },
        },
        {
          provide: MemoryContentScannerService,
          useValue: { scanContent: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<MemoryManagerService>(MemoryManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a memory segment', async () => {
    const result = await service.createMemorySegment(
      'User',
      'u1',
      'content',
      'fact',
    );
    expect(result.entity_id).toBe('u1');
    expect(createMemorySegment).toHaveBeenCalledWith(
      'User',
      'u1',
      'content',
      'fact',
    );
    expect(
      pluginEventPublisher.publishMemoryRecordedEvent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: 'uuid',
        entityType: 'User',
        entityId: 'u1',
        memoryType: 'fact',
      }),
    );
    expect(memoryMetrics.setActiveSegments).toHaveBeenCalledWith(
      'postgres',
      'memory',
      1,
    );
    expect(promMetrics.setMemoryBackendActiveSegments).toHaveBeenCalledWith(
      'postgres',
      'memory',
      1,
    );
  });

  it('passes optional provenance metadata when creating a memory segment', async () => {
    const metadata = {
      source: 'chat',
      source_id: 'message-1',
    };

    await service.createMemorySegment(
      'User',
      'u1',
      'content',
      'fact',
      metadata,
    );

    expect(createMemorySegment).toHaveBeenCalledWith(
      'User',
      'u1',
      'content',
      'fact',
      metadata,
    );
  });

  it('does not publish memory lifecycle events when backend create fails', async () => {
    createMemorySegment.mockRejectedValueOnce(new Error('backend failure'));

    await expect(
      service.createMemorySegment('User', 'u1', 'content', 'fact'),
    ).rejects.toThrow('backend failure');

    expect(
      pluginEventPublisher.publishMemoryRecordedEvent,
    ).not.toHaveBeenCalled();
    expect(memoryMetrics.setActiveSegments).not.toHaveBeenCalled();
  });

  it('should search memory', async () => {
    await service.searchMemory('User', 'u1', 'test');
    expect(searchMemory).toHaveBeenCalledWith('User', 'u1', 'test');
  });

  it('should search memory by entity type', async () => {
    await service.searchMemoryByType('System', 'test', {
      memory_type: 'fact',
    });
    expect(searchMemoryByType).toHaveBeenCalledWith('System', 'test', {
      memory_type: 'fact',
    });
  });

  it('should throw if update target does not exist', async () => {
    mockBackend.updateMemorySegment.mockResolvedValueOnce(null);

    await expect(
      service.updateMemorySegment('missing', 'value'),
    ).rejects.toThrow('Memory segment missing not found');
  });

  it('should delegate promoted lesson search to the backend', async () => {
    const promoted = {
      id: 'promoted-1',
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      content: 'cited repair evidence',
      memory_type: 'fact' as const,
      version: 1,
      metadata_json: { source: 'learning_candidate' },
      created_at: new Date(),
      updated_at: new Date(),
    };
    searchPromotedLessonsByScope.mockResolvedValueOnce([promoted]);

    const result = await service.searchPromotedLessonsByScope({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      limit: 3,
    });

    expect(searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      limit: 3,
    });
    expect(result).toEqual([promoted]);
  });

  // -----------------------------------------------------------------
  // Read-path reinforcement (work item 3d7fb798, milestone 3)
  // -----------------------------------------------------------------
  //
  // The `MemoryManagerService` is responsible for keeping hot
  // segments fresh in the nightly `MemoryDecayReaper`'s
  // `effective_last_touch = max(last_accessed_at,
  // last_reinforced_at)` composite. Every successful read of a
  // segment via `getMemorySegments` / `searchMemory` bumps
  // `last_reinforced_at` (best-effort, fire-and-forget) so the
  // decay reaper does not flag a frequently-consumed segment as
  // stale just because no separate "touch" path refreshed its
  // timestamp.
  //
  // The contract that these tests pin:
  //   1. The repository's `touchReinforcedAt(ids)` is invoked
  //      with the ids of every returned segment after each read.
  //   2. The call is NOT awaited — the read returns the segment
  //      list before the repository helper resolves.
  //   3. A rejected promise from the repository never bubbles out
  //      of the read path — the read still resolves with its
  //      payload.
  //   4. Non-read methods (`createMemorySegment`,
  //      `updateMemorySegment`, `deleteMemorySegment`,
  //      `searchPromotedLessonsByScope`, etc.) do NOT trigger a
  //      reinforcement bump — the bump is reserved for the two
  //      read methods the work item calls out explicitly.
  //   5. An empty read result skips the bump entirely (no SQL
  //      round-trip).

  describe('read-path reinforcement', () => {
    function buildSegment(
      id: string,
      overrides: Partial<{ entity_type: string; entity_id: string }> = {},
    ) {
      return {
        id,
        entity_type: overrides.entity_type ?? 'User',
        entity_id: overrides.entity_id ?? 'u1',
        content: 'content',
        memory_type: 'fact' as const,
        version: 1,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      };
    }

    it('bumps last_reinforced_at on every segment returned by getMemorySegments', async () => {
      const segA = buildSegment('seg-a');
      const segB = buildSegment('seg-b');
      const segC = buildSegment('seg-c');
      mockBackend.getMemorySegments.mockResolvedValueOnce([segA, segB, segC]);

      const result = await service.getMemorySegments('User', 'u1');

      expect(result).toEqual([segA, segB, segC]);
      // The repository helper is called exactly once with the full
      // id list — not once per segment. Fire-and-forget means the
      // assertion is racy on resolution but the synchronous
      // invocation site is observable through `.toHaveBeenCalledWith`.
      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledTimes(1);
      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledWith([
        'seg-a',
        'seg-b',
        'seg-c',
      ]);
    });

    it('bumps last_reinforced_at on every segment returned by searchMemory', async () => {
      const segA = buildSegment('seg-a');
      const segB = buildSegment('seg-b');
      searchMemory.mockResolvedValueOnce([segA, segB]);

      const result = await service.searchMemory('User', 'u1', 'preference');

      expect(result).toEqual([segA, segB]);
      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledTimes(1);
      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledWith([
        'seg-a',
        'seg-b',
      ]);
    });

    it('returns the read payload before the bump resolves (fire-and-forget)', async () => {
      // Simulate a slow reinforcement: the helper only resolves
      // after the test releases a manual latch. If the service
      // awaited the call, the read would block until we release;
      // because it does NOT, the read resolves immediately.
      let release: () => void = () => undefined;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      memorySegmentRepo.touchReinforcedAt.mockImplementationOnce(() => blocked);

      const seg = buildSegment('seg-slow');
      mockBackend.getMemorySegments.mockResolvedValueOnce([seg]);

      const result = await service.getMemorySegments('User', 'u1');
      expect(result).toEqual([seg]);

      // The latch is still held — proves the read did not wait.
      // We release it so the pending promise settles cleanly
      // before the test ends (avoids an unhandled-rejection
      // warning if Vitest's leak detector runs).
      release();
      await blocked;
    });

    it('does not propagate a rejected reinforcement promise (errors are swallowed)', async () => {
      // The repository helper is documented to swallow errors
      // internally, but the service still attaches a defensive
      // `.catch(() => undefined)` so a future refactor of the
      // helper cannot accidentally let an error escape. Simulate
      // a worst-case "helper throws" scenario and verify the
      // caller still returns cleanly.
      memorySegmentRepo.touchReinforcedAt.mockRejectedValueOnce(
        new Error('simulated connection blip'),
      );

      const seg = buildSegment('seg-flaky');
      mockBackend.getMemorySegments.mockResolvedValueOnce([seg]);

      // The read MUST resolve with the segment payload even when
      // the bump rejects. No exception escapes the read path.
      await expect(service.getMemorySegments('User', 'u1')).resolves.toEqual([
        seg,
      ]);
    });

    it('skips the bump when getMemorySegments returns an empty array', async () => {
      mockBackend.getMemorySegments.mockResolvedValueOnce([]);

      const result = await service.getMemorySegments('User', 'u1');

      expect(result).toEqual([]);
      expect(memorySegmentRepo.touchReinforcedAt).not.toHaveBeenCalled();
    });

    it('skips the bump when searchMemory returns an empty array', async () => {
      searchMemory.mockResolvedValueOnce([]);

      const result = await service.searchMemory('User', 'u1', 'no-match');

      expect(result).toEqual([]);
      expect(memorySegmentRepo.touchReinforcedAt).not.toHaveBeenCalled();
    });

    it('does NOT bump for non-read methods (writes / promoted-lesson search)', async () => {
      // The reinforcement helper is reserved for the two read
      // methods the work item calls out explicitly. Writes
      // (`createMemorySegment`, `updateMemorySegment`,
      // `deleteMemorySegment`) and the promoted-lesson search
      // (`searchPromotedLessonsByScope`) must not invoke it.
      await service.createMemorySegment('User', 'u1', 'content', 'fact');
      await service.updateMemorySegment('uuid', 'updated');
      await service.deleteMemorySegment('uuid');
      await service.searchPromotedLessonsByScope({ entity_type: 'System' });

      expect(memorySegmentRepo.touchReinforcedAt).not.toHaveBeenCalled();
    });

    it('drops empty / non-string ids before calling the repository', async () => {
      // The Honcho backend can synthesise ids like
      // `${entityType}:${entityId}:${index}` when an upstream
      // record lacks an `id` field. Those ids are not real
      // `memory_segments.id` values; the service filters them
      // out so the `IN (...)` clause only ever contains real
      // database ids. An id-only-empty-string row also exercises
      // the empty-string short-circuit.
      const realA = buildSegment('seg-real-a');
      const realB = buildSegment('seg-real-b');
      const synthetic = {
        ...buildSegment('User:u1:0'),
        // Force the Honcho-style synthetic id through the same
        // id field; the filter accepts any non-empty string, so
        // the assertion below uses an empty-string shape to
        // exercise the "drop non-string" branch.
        id: '',
      };
      const nullish = {
        ...buildSegment('User:u1:1'),
        id: undefined as unknown as string,
      };
      mockBackend.getMemorySegments.mockResolvedValueOnce([
        realA,
        synthetic,
        realB,
        nullish,
      ]);

      await service.getMemorySegments('User', 'u1');

      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledTimes(1);
      expect(memorySegmentRepo.touchReinforcedAt).toHaveBeenCalledWith([
        'seg-real-a',
        'seg-real-b',
      ]);
    });
  });

  // -----------------------------------------------------------------
  // upsertMemorySegment (work item 3fd06164, milestone 3)
  // -----------------------------------------------------------------
  //
  // The strategic-intent upsert flow replaces both the textual
  // `content` and the structured `metadata_json` payload in one
  // round-trip. The contract pinned by these tests is:
  //
  //   1. On the UPDATE path (an existing `strategic_intent` segment
  //      is found for the scope), the manager MUST call
  //      `backend.updateMemorySegmentWithMetadata(id, content,
  //      metadata)` — it MUST NOT silently fall back to
  //      `backend.updateMemorySegment(id, content)` (which would
  //      drop the metadata payload). The previous milestone 1
  //      implementation had a silent-drop ternary that hid
  //      metadata-loss bugs; these tests guard against that.
  //
  //   2. The memory-recorded lifecycle event is published exactly
  //      once after a successful upsert, mirroring the existing
  //      `createMemorySegment` semantics.
  //
  //   3. When the resolved backend lacks
  //      `updateMemorySegmentWithMetadata` (a misconfigured
  //      `MEMORY_BACKEND_TOKEN` provider), the manager MUST throw
  //      a `NotImplementedException` whose message names the
  //      missing method. The agent-facing
  //      `record_strategic_intent` tool surfaces that exception
  //      as a structured tool error rather than silently dropping
  //      the strategic-intent payload (see
  //      `MemoryToolsHandler.recordStrategicIntent` JSDoc).

  describe('upsertMemorySegment', () => {
    it('persists metadata via updateMemorySegmentWithMetadata on the update path', async () => {
      const now = new Date('2026-06-15T00:00:00.000Z');
      const updatedSegment = {
        id: 'existing-id',
        entity_type: 'User' as const,
        entity_id: 'u1',
        content: 'new content',
        memory_type: 'strategic_intent' as const,
        version: 2,
        created_at: now,
        updated_at: now,
        metadata_json: { horizon: 'q1', priority_themes: ['x'] },
      };
      // Pre-pin the metadata-aware update method's resolution so
      // we can assert the return value matches the mock exactly.
      updateMemorySegmentWithMetadata.mockResolvedValueOnce(updatedSegment);

      // Drive the update path: an existing strategic-intent row
      // exists for the scope, so the manager MUST route through
      // `updateMemorySegmentWithMetadata`.
      mockBackend.getMemorySegments.mockResolvedValueOnce([
        {
          id: 'existing-id',
          entity_type: 'User' as const,
          entity_id: 'u1',
          content: 'old',
          memory_type: 'strategic_intent' as const,
          version: 1,
          created_at: now,
          updated_at: now,
          metadata_json: null,
        },
      ]);

      const metadata = { horizon: 'q1', priority_themes: ['x'] };
      const result = await service.upsertMemorySegment(
        'User',
        'u1',
        'strategic_intent',
        'new content',
        metadata,
      );

      // The metadata payload MUST be forwarded to the
      // metadata-aware update method in a single call. The
      // content is also passed through so the search-text
      // column stays current.
      expect(updateMemorySegmentWithMetadata).toHaveBeenCalledTimes(1);
      expect(updateMemorySegmentWithMetadata).toHaveBeenCalledWith(
        'existing-id',
        'new content',
        metadata,
      );

      // The silent-drop fallback is GONE: the legacy
      // `updateMemorySegment` (content-only) MUST NOT be called
      // when a metadata payload is supplied — otherwise the
      // metadata would be silently discarded.
      expect(mockBackend.updateMemorySegment).not.toHaveBeenCalled();

      // The resolved segment is returned verbatim so callers can
      // echo the new version/timestamp back to the agent.
      expect(result).toBe(updatedSegment);

      // The memory-recorded lifecycle event MUST be published
      // exactly once after a successful upsert, mirroring
      // `createMemorySegment`.
      expect(
        pluginEventPublisher.publishMemoryRecordedEvent,
      ).toHaveBeenCalledTimes(1);
      expect(
        pluginEventPublisher.publishMemoryRecordedEvent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentId: 'existing-id',
          entityType: 'User',
          entityId: 'u1',
          memoryType: 'strategic_intent',
        }),
      );
    });

    it('throws NotImplementedException when the resolved backend lacks updateMemorySegmentWithMetadata', async () => {
      // Build a fresh `TestingModule` whose `MEMORY_BACKEND_TOKEN`
      // provider is a `Pick<MemoryBackend, ...>` value that
      // EXPLICITLY omits `updateMemorySegmentWithMetadata`. The
      // service's runtime `typeof` guard then trips and the
      // upsert surfaces a `NotImplementedException`.
      const now = new Date('2026-06-15T00:00:00.000Z');
      type PartialBackend = Pick<
        MemoryBackend,
        | 'createMemorySegment'
        | 'getMemorySegments'
        | 'getMemorySegmentsByType'
        | 'updateMemorySegment'
        | 'deleteMemorySegment'
        | 'searchMemory'
        | 'searchMemoryByType'
        | 'searchPromotedLessonsByScope'
      >;
      const partialBackend: PartialBackend = {
        createMemorySegment: vi.fn(),
        getMemorySegments: vi.fn().mockResolvedValue([
          {
            id: 'existing-id',
            entity_type: 'User' as const,
            entity_id: 'u1',
            content: 'old',
            memory_type: 'strategic_intent' as const,
            version: 1,
            created_at: now,
            updated_at: now,
            metadata_json: null,
          },
        ]),
        getMemorySegmentsByType: vi.fn().mockResolvedValue([]),
        updateMemorySegment: vi.fn().mockResolvedValue(null),
        deleteMemorySegment: vi.fn().mockResolvedValue(undefined),
        searchMemory: vi.fn().mockResolvedValue([]),
        searchMemoryByType: vi.fn().mockResolvedValue([]),
        searchPromotedLessonsByScope: vi.fn().mockResolvedValue([]),
      };

      const partialModule: TestingModule = await Test.createTestingModule({
        providers: [
          MemoryManagerService,
          {
            provide: MEMORY_BACKEND_TOKEN,
            // The service types its backend as the full
            // `MemoryBackend` contract; the partial pick is the
            // test fixture's "backend does not implement the
            // method" shape. The `as MemoryBackend` hop is the
            // test-only bridge — the runtime guard is what
            // actually enforces the contract.
            useValue: partialBackend as MemoryBackend,
          },
          {
            provide: PluginEventPublisherService,
            useValue: pluginEventPublisher,
          },
          {
            provide: MemoryMetricsService,
            useValue: memoryMetrics,
          },
          {
            provide: MetricsService,
            useValue: promMetrics,
          },
          {
            provide: MemorySegmentDecayRepository,
            useValue: memorySegmentRepo,
          },
          {
            provide: EmbeddingWriteEnqueueService,
            useValue: { enqueueOwner: vi.fn() },
          },
          {
            provide: MemoryContentScannerService,
            useValue: { scanContent: vi.fn() },
          },
        ],
      }).compile();

      const partialService =
        partialModule.get<MemoryManagerService>(MemoryManagerService);

      // The upsert MUST reject with `NotImplementedException`.
      await expect(
        partialService.upsertMemorySegment(
          'User',
          'u1',
          'strategic_intent',
          'new',
          { horizon: 'q1' },
        ),
      ).rejects.toThrow(NotImplementedException);

      // And the error message MUST name the missing method so
      // operators can diagnose the misconfigured DI provider
      // from a stack trace alone.
      await expect(
        partialService.upsertMemorySegment(
          'User',
          'u1',
          'strategic_intent',
          'new',
          { horizon: 'q1' },
        ),
      ).rejects.toThrow(/updateMemorySegmentWithMetadata/);

      // The legacy content-only `updateMemorySegment` MUST NOT
      // be called either — the manager refuses to silently
      // downgrade to the metadata-dropping path.
      expect(partialBackend.updateMemorySegment).not.toHaveBeenCalled();
    });
  });
});
