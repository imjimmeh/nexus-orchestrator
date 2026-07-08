import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { IMemorySegment } from '@nexus/core';
import { BackendInstrumentation } from './backend-instrumentation';
import { HonchoClientService } from './honcho-client.service';
import { HonchoMemoryBackendService } from './honcho-memory-backend.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Pre-normalized `IMemorySegment` fixture for the honcho read mocks.
 *
 * After M2 the `HonchoClientService` read helpers return
 * `Promise<IMemorySegment[]>` directly — the contract is typed at
 * the client boundary, so the backend no longer normalizes the
 * envelope. Tests therefore mock the client with a pre-shaped
 * array. This factory keeps the inline mock setups ≤ 6 lines per
 * test (Task 3.2).
 */
function makeSegment(overrides: Partial<IMemorySegment> = {}): IMemorySegment {
  return {
    id: 'm-1',
    entity_type: 'User',
    entity_id: 'u1',
    memory_type: 'fact',
    content: 'found memory',
    version: 1,
    created_at: new Date('2026-04-06T00:00:00.000Z'),
    updated_at: new Date('2026-04-06T00:01:00.000Z'),
    ...overrides,
  };
}

function createMetrics() {
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

function createPromClient() {
  return {
    recordMemoryBackendRead: vi.fn(),
    recordMemoryBackendWrite: vi.fn(),
    setMemoryBackendActiveSegments: vi.fn(),
    recordMemoryBackendFallback: vi.fn(),
    recordDistillationCompleted: vi.fn(),
    recordLearningPromoted: vi.fn(),
  } as unknown as MetricsService;
}

/**
 * Build a `HonchoMemoryBackendService` wired to a real
 * `BackendInstrumentation` instance whose `memoryMetrics` and
 * `metricsService` deps are the per-test mocks. Wiring the helper
 * directly against the mocks keeps the existing assertions (which
 * check `memoryMetrics.recordBackendWrite` /
 * `metrics.recordMemoryBackendWrite` call shapes) valid — the
 * helper internally invokes both mirrors, so the assertions still
 * observe the expected mock calls without needing to spy on the
 * helper's `recordWrite` / `recordRead` methods.
 */
function createService(
  client: HonchoClientService,
  postgres: PostgresMemoryBackendService,
  configService: ConfigService,
): {
  service: HonchoMemoryBackendService;
  memoryMetrics: MemoryMetricsService;
  metrics: MetricsService;
} {
  const memoryMetrics = createMetrics();
  const metrics = createPromClient();
  const backendInstrumentation = new BackendInstrumentation(
    memoryMetrics,
    metrics,
  );
  return {
    service: new HonchoMemoryBackendService(
      client,
      postgres,
      configService,
      backendInstrumentation,
    ),
    memoryMetrics,
    metrics,
  };
}

describe('HonchoMemoryBackendService', () => {
  function createConfig(overrides?: Record<string, string>): ConfigService {
    const values: Record<string, string> = {
      HONCHO_FALLBACK_ON_ERROR: 'true',
      HONCHO_FALLBACK_ON_EMPTY: 'true',
      HONCHO_WORKSPACE_STRATEGY: 'global',
      HONCHO_DEFAULT_WORKSPACE: 'nexus',
      ...(overrides || {}),
    };

    return {
      get: vi.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  it('passes provenance metadata through postgres writes', async () => {
    const createMemorySegment = vi.fn().mockResolvedValue({ id: 'pg-1' });
    const client = {
      searchPeerMemory: vi.fn(),
      listPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;
    const postgres = {
      createMemorySegment,
    } as unknown as PostgresMemoryBackendService;
    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );
    const metadata = { source: 'chat', source_id: 'message-1' };

    await service.createMemorySegment(
      'User',
      'u1',
      'remember this',
      'fact',
      metadata,
    );

    expect(createMemorySegment).toHaveBeenCalledWith(
      'User',
      'u1',
      'remember this',
      'fact',
      metadata,
    );
    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'honcho',
      'success',
    );
    expect(metrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
      'honcho',
      'success',
    );
  });

  it('records a honcho write failure and rethrows when postgres write fails', async () => {
    const createMemorySegment = vi.fn().mockRejectedValue(new Error('boom'));
    const client = {
      searchPeerMemory: vi.fn(),
      listPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;
    const postgres = {
      createMemorySegment,
    } as unknown as PostgresMemoryBackendService;
    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );

    await expect(
      service.createMemorySegment('User', 'u1', 'remember this'),
    ).rejects.toThrow('boom');

    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'honcho',
      'failure',
    );
    expect(metrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
      'honcho',
      'failure',
    );
  });

  it('maps honcho search results to memory segments', async () => {
    const client = {
      searchPeerMemory: vi
        .fn()
        .mockResolvedValue([makeSegment({ version: 4 })]),
      listPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      searchMemory: vi.fn(),
      getMemorySegments: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );

    const result = await service.searchMemory('User', 'u1', 'found');

    expect(result).toHaveLength(1);
    expect(result[0].memory_type).toBe('fact');
    expect(result[0].content).toBe('found memory');
    expect(result[0].version).toBe(4);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
  });

  it('falls back to postgres when honcho search fails', async () => {
    const searchMemory = vi.fn().mockResolvedValue([
      {
        id: 'pg-1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'history',
        content: 'fallback',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const client = {
      searchPeerMemory: vi.fn().mockRejectedValue(new Error('network')),
      listPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      searchMemory,
      getMemorySegments: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig({ HONCHO_FALLBACK_ON_ERROR: 'true' }),
    );

    const result = await service.searchMemory('User', 'u1', 'fallback');

    expect(searchMemory).toHaveBeenCalledWith('User', 'u1', 'fallback');
    expect(result[0].id).toBe('pg-1');
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'searchMemory',
    );
    expect(metrics.recordMemoryBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'searchMemory',
    );
  });

  it('uses per-project workspace strategy for project entities', async () => {
    const listPeerMemory = vi.fn().mockResolvedValue([] as IMemorySegment[]);
    const client = {
      listPeerMemory,
      searchPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      getMemorySegments: vi.fn().mockResolvedValue([]),
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig({ HONCHO_WORKSPACE_STRATEGY: 'per_project' }),
    );

    await service.getMemorySegments('Project', 'ABC_123');

    expect(listPeerMemory).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'project-abc_123' }),
    );
  });

  it('falls back to postgres for aggregate system memory listing', async () => {
    const getMemorySegmentsByType = vi.fn().mockResolvedValue([
      {
        id: 'pg-1',
        entity_type: 'System',
        entity_id: 'shared',
        memory_type: 'fact',
        content: 'fallback',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const client = {
      listPeerMemory: vi.fn(),
      searchPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      getMemorySegmentsByType,
      searchMemoryByType: vi.fn(),
      getMemorySegments: vi.fn(),
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );

    const result = await service.getMemorySegmentsByType('System', {
      memory_type: 'fact',
    });

    expect(getMemorySegmentsByType).toHaveBeenCalledWith('System', {
      memory_type: 'fact',
    });
    expect(result[0].id).toBe('pg-1');
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'getMemorySegmentsByType',
    );
  });

  it('lists promoted lessons from postgres (honcho does not model provenance)', async () => {
    const searchPromotedLessonsByScope = vi.fn().mockResolvedValue([
      {
        id: 'promoted-1',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        memory_type: 'fact',
        content: 'cited repair evidence',
        version: 1,
        metadata_json: { source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const client = {
      searchPeerMemory: vi.fn(),
      listPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      searchPromotedLessonsByScope,
      searchMemory: vi.fn(),
      getMemorySegments: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );

    const result = await service.searchPromotedLessonsByScope({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      limit: 5,
    });

    expect(searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      limit: 5,
    });
    expect(result[0].id).toBe('promoted-1');
  });

  // Drift D2 regression — `BackendInstrumentation.recordRead` observes
  // honcho read latency in `finally`, so the honcho read counter is
  // recorded exactly once whether the honcho call succeeds, throws,
  // or triggers a postgres fallback. The legacy path double-counted
  // when `HONCHO_FALLBACK_ON_ERROR=false` (the helper's `finally` and
  // the outer catch both recorded). These tests pin the count to 1.

  it('records honcho read latency exactly once on a successful honcho read', async () => {
    const listPeerMemory = vi.fn().mockResolvedValue([makeSegment()]);
    const client = {
      listPeerMemory,
      searchPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      getMemorySegments: vi.fn(),
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig(),
    );

    const result = await service.getMemorySegments('User', 'u1');

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('found memory');
    expect(postgres.getMemorySegments).not.toHaveBeenCalled();
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
  });

  it('records honcho read latency exactly once when HONCHO_FALLBACK_ON_ERROR=false and the honcho call throws', async () => {
    const client = {
      listPeerMemory: vi.fn().mockRejectedValue(new Error('boom')),
      searchPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      getMemorySegments: vi.fn(),
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig({ HONCHO_FALLBACK_ON_ERROR: 'false' }),
    );

    await expect(service.getMemorySegments('User', 'u1')).rejects.toThrow(
      'boom',
    );

    expect(postgres.getMemorySegments).not.toHaveBeenCalled();
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
  });

  it('records honcho read latency exactly once when fallback succeeds', async () => {
    const getMemorySegments = vi.fn().mockResolvedValue([
      {
        id: 'pg-1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'fact',
        content: 'fallback memory',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const client = {
      listPeerMemory: vi.fn().mockRejectedValue(new Error('boom')),
      searchPeerMemory: vi.fn(),
    } as unknown as HonchoClientService;

    const postgres = {
      getMemorySegments,
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService(
      client,
      postgres,
      createConfig({ HONCHO_FALLBACK_ON_ERROR: 'true' }),
    );

    const result = await service.getMemorySegments('User', 'u1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pg-1');
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
  });
});
