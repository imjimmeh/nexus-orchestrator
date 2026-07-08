import { describe, expect, it, vi } from 'vitest';
import { BackendInstrumentation } from './backend-instrumentation';
import { HonchoFallbackMemoryBackendService } from './honcho-fallback-memory-backend.service';
import { HonchoMemoryBackendService } from './honcho-memory-backend.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';

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

type HonchoFallbackMemoryMetricsMocks = ReturnType<typeof createMetrics>;
type HonchoFallbackPromMetricsMocks = ReturnType<typeof createPromClient>;

/**
 * Build a `HonchoFallbackMemoryBackendService` wired to a real
 * `BackendInstrumentation` instance whose `memoryMetrics` and
 * `metricsService` deps are the per-test mocks. The helper internally
 * invokes both mirrors, so the existing spy assertions
 * (`memoryMetrics.recordBackendWrite` /
 * `memoryMetrics.recordBackendRead` / etc.) still observe the expected
 * mock calls without needing to spy on the helper itself.
 */
function createService(opts: {
  honcho: Partial<HonchoMemoryBackendService>;
  postgres: Partial<PostgresMemoryBackendService>;
}): {
  service: HonchoFallbackMemoryBackendService;
  memoryMetrics: HonchoFallbackMemoryMetricsMocks;
  metrics: HonchoFallbackPromMetricsMocks;
} {
  const memoryMetrics = createMetrics();
  const metrics = createPromClient();
  const backendInstrumentation = new BackendInstrumentation(
    memoryMetrics,
    metrics,
  );
  const service = new HonchoFallbackMemoryBackendService(
    opts.honcho as HonchoMemoryBackendService,
    opts.postgres as PostgresMemoryBackendService,
    backendInstrumentation,
  );
  return { service, memoryMetrics, metrics };
}

describe('HonchoFallbackMemoryBackendService', () => {
  it('passes provenance metadata through postgres writes', async () => {
    const honcho = {} as unknown as HonchoMemoryBackendService;
    const createMemorySegment = vi.fn().mockResolvedValue({ id: 'pg1' });
    const postgres = {
      createMemorySegment,
    } as unknown as PostgresMemoryBackendService;
    const { service, memoryMetrics, metrics } = createService({
      honcho,
      postgres,
    });
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

  it('records a honcho write failure when postgres write fails', async () => {
    const honcho = {} as unknown as HonchoMemoryBackendService;
    const createMemorySegment = vi.fn().mockRejectedValue(new Error('boom'));
    const postgres = {
      createMemorySegment,
    } as unknown as PostgresMemoryBackendService;
    const { service, memoryMetrics } = createService({ honcho, postgres });

    await expect(
      service.createMemorySegment('User', 'u1', 'remember this'),
    ).rejects.toThrow('boom');

    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'honcho',
      'failure',
    );
  });

  it('uses honcho for search when available', async () => {
    const honchoSearchMemory = vi.fn().mockResolvedValue([
      {
        id: 'h1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'fact',
        content: 'from honcho',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const postgresSearchMemory = vi.fn();
    const honcho = {
      searchMemory: honchoSearchMemory,
      getMemorySegments: vi.fn(),
    } as unknown as HonchoMemoryBackendService;

    const postgres = {
      searchMemory: postgresSearchMemory,
      createMemorySegment: vi.fn(),
      getMemorySegments: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService({
      honcho,
      postgres,
    });

    const result = await service.searchMemory('User', 'u1', 'x');

    expect(honchoSearchMemory).toHaveBeenCalledWith('User', 'u1', 'x');
    expect(postgresSearchMemory).not.toHaveBeenCalled();
    expect(result[0].id).toBe('h1');
    // Helper fires read latency exactly once on success (drift D1).
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
    // No fallback counter on the happy path.
    expect(memoryMetrics.recordBackendFallback).not.toHaveBeenCalled();
    expect(metrics.recordMemoryBackendFallback).not.toHaveBeenCalled();
  });

  it('falls back to postgres when honcho throws', async () => {
    const postgresSearchMemory = vi.fn().mockResolvedValue([
      {
        id: 'pg1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'history',
        content: 'from postgres',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const honcho = {
      searchMemory: vi.fn().mockRejectedValue(new Error('down')),
      getMemorySegments: vi.fn(),
    } as unknown as HonchoMemoryBackendService;

    const postgres = {
      searchMemory: postgresSearchMemory,
      createMemorySegment: vi.fn(),
      getMemorySegments: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService({
      honcho,
      postgres,
    });

    const result = await service.searchMemory('User', 'u1', 'x');

    expect(postgresSearchMemory).toHaveBeenCalledWith('User', 'u1', 'x');
    expect(result[0].id).toBe('pg1');
    // Drift D1 fix — read latency is observed in the helper's
    // `finally` block on the failure path.
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'searchMemory',
    );
    expect(metrics.recordMemoryBackendFallback).toHaveBeenCalledTimes(1);
    expect(metrics.recordMemoryBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'searchMemory',
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
    const honcho = {
      searchMemory: vi.fn(),
      getMemorySegments: vi.fn(),
    } as unknown as HonchoMemoryBackendService;

    const postgres = {
      searchPromotedLessonsByScope,
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      getMemorySegments: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const memoryMetrics = createMetrics();
    const metrics = createPromClient();
    const backendInstrumentation = new BackendInstrumentation(
      memoryMetrics,
      metrics,
    );
    const service = new HonchoFallbackMemoryBackendService(
      honcho,
      postgres,
      backendInstrumentation,
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

  /**
   * Drift D2 symmetric fix — verifies that when the underlying
   * `HonchoMemoryBackendService.getMemorySegments` is reached via
   * this HonchoFallback backend (the wiring tested by
   * `HonchoFallbackMemoryBackendService.getMemorySegments`), the
   * honcho read latency is recorded EXACTLY ONCE per attempt across
   * the helper and this backend's catch.
   *
   * Pre-refactor: the inner `HonchoMemoryBackendService.getMemorySegments`
   * recorded `recordBackendRead('honcho', ...)` in its own catch (when
   * `HONCHO_FALLBACK_ON_ERROR=false`), then re-threw, and the outer
   * `HonchoFallbackMemoryBackendService.getMemorySegments` caught
   * the re-throw and called `recordBackendRead('honcho', ...)` AGAIN.
   * Two observations per attempt.
   *
   * Post-refactor: the helper's `recordRead` `finally` block fires
   * the latency observation exactly once. The HonchoFallback catch
   * does NOT call `recordBackendRead` directly — its fallback path
   * is delegated to `BackendInstrumentation.recordFallback` (which
   * does not observe primary latency unless the caller passes
   * `recordPrimaryLatencyMs`, which this class does not).
   */
  it('records honcho read latency exactly once when fallback engages (drift D2 symmetric fix)', async () => {
    const postgresGetMemorySegments = vi.fn().mockResolvedValue([
      {
        id: 'pg1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'history',
        content: 'from postgres',
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const honcho = {
      getMemorySegments: vi.fn().mockRejectedValue(new Error('down')),
      searchMemory: vi.fn(),
    } as unknown as HonchoMemoryBackendService;

    const postgres = {
      getMemorySegments: postgresGetMemorySegments,
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService({
      honcho,
      postgres,
    });

    const result = await service.getMemorySegments('User', 'u1');

    expect(result[0].id).toBe('pg1');
    expect(postgresGetMemorySegments).toHaveBeenCalledWith(
      'User',
      'u1',
      undefined,
    );

    // Drift D2 fix — the honcho read latency is observed EXACTLY
    // once across the inner `HonchoMemoryBackendService.recordRead`
    // helper and the outer `HonchoFallbackMemoryBackendService` catch.
    // Pre-refactor, the legacy `HonchoFallbackMemoryBackendService`
    // catch recorded `recordBackendRead('honcho', ...)` AGAIN on top
    // of the inner Honcho service's own `recordRead` call — two
    // observations per attempt. After the helper migration, the
    // helper's `finally` block fires the latency observation
    // exactly once and the outer catch does not duplicate it.
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );

    // Fallback counter fires exactly once on each mirror — the outer
    // catch delegates to `BackendInstrumentation.recordFallback`.
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'getMemorySegments',
    );
    expect(metrics.recordMemoryBackendFallback).toHaveBeenCalledTimes(1);
    expect(metrics.recordMemoryBackendFallback).toHaveBeenCalledWith(
      'honcho',
      'postgres',
      'getMemorySegments',
    );
  });

  /**
   * Drift D1 — verifies that the honcho read latency is observed
   * on a SUCCESSFUL honcho read through the HonchoFallback backend
   * (the legacy code only recorded latency on the catch path, so a
   * successful honcho read lost its latency observation entirely).
   */
  it('records honcho read latency exactly once on a successful honcho read (drift D1 fix)', async () => {
    const honcho = {
      getMemorySegments: vi.fn().mockResolvedValue([
        {
          id: 'h1',
          entity_type: 'User',
          entity_id: 'u1',
          memory_type: 'fact',
          content: 'from honcho',
          version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]),
      searchMemory: vi.fn(),
    } as unknown as HonchoMemoryBackendService;

    const postgres = {
      getMemorySegments: vi.fn(),
      searchMemory: vi.fn(),
      createMemorySegment: vi.fn(),
      updateMemorySegment: vi.fn(),
      deleteMemorySegment: vi.fn(),
    } as unknown as PostgresMemoryBackendService;

    const { service, memoryMetrics, metrics } = createService({
      honcho,
      postgres,
    });

    const result = await service.getMemorySegments('User', 'u1');

    expect(result[0].id).toBe('h1');
    // Drift D1 fix — the helper's `finally` block fires the latency
    // observation on the SUCCESS path too. Pre-refactor, the legacy
    // HonchoFallback backend only recorded `recordBackendRead('honcho', ...)`
    // inside its catch, so successful honcho reads were lost from the
    // histogram.
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledTimes(1);
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledWith(
      'honcho',
      expect.any(Number),
    );
    // No fallback counter on the success path.
    expect(memoryMetrics.recordBackendFallback).not.toHaveBeenCalled();
    expect(metrics.recordMemoryBackendFallback).not.toHaveBeenCalled();
  });
});
