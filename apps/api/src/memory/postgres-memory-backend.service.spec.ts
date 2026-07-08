import { describe, expect, it, vi } from 'vitest';
import { BackendInstrumentation } from './backend-instrumentation';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import { MemorySegmentSearchRepository } from './database/repositories/memory-segment.search.repository';
import { MemorySegmentLearningCandidateRepository } from './database/repositories/memory-segment.learning-candidate.repository';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';

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

type PostgresMemoryBackendMocks = ReturnType<typeof createMetrics>;
type PostgresPromBackendMocks = ReturnType<typeof createPromClient>;

/**
 * Per-intent repository mock factories. The split introduced in
 * work item b8c754af-9037-45fb-91ed-278752284b0f splits the original
 * `MemorySegmentRepository` into per-intent repositories
 * (`crudRepo`, `searchRepo`, `learningCandidateRepo`). Each helper
 * below returns a partial mock that covers the methods used by the
 * test cases in this file. Tests instantiate only the methods they
 * exercise and the rest are no-op / un-stubbed.
 */
function createCrudRepoMock(
  partial: Partial<MemorySegmentCrudRepository>,
): Partial<MemorySegmentCrudRepository> {
  return partial;
}

function createSearchRepoMock(
  partial: Partial<MemorySegmentSearchRepository>,
): Partial<MemorySegmentSearchRepository> {
  return partial;
}

function createLearningCandidateRepoMock(
  partial: Partial<MemorySegmentLearningCandidateRepository>,
): Partial<MemorySegmentLearningCandidateRepository> {
  return partial;
}

/**
 * Build a `PostgresMemoryBackendService` wired to a real
 * `BackendInstrumentation` instance whose `memoryMetrics` and
 * `metricsService` deps are the per-test mocks. Wiring the helper
 * directly against the mocks keeps the existing assertions (which
 * check `memoryMetrics.recordBackendWrite` / `metrics.recordMemoryBackendWrite`
 * call shapes) valid — the helper internally invokes both mirrors,
 * so the assertions still observe the expected mock calls without
 * needing to spy on the helper's `recordWrite` / `recordRead`
 * methods.
 */
function createService(repos: {
  crud?: Partial<MemorySegmentCrudRepository>;
  search?: Partial<MemorySegmentSearchRepository>;
  learningCandidate?: Partial<MemorySegmentLearningCandidateRepository>;
}): {
  service: PostgresMemoryBackendService;
  memoryMetrics: PostgresMemoryBackendMocks;
  metrics: PostgresPromBackendMocks;
} {
  const memoryMetrics = createMetrics();
  const metrics = createPromClient();
  const backendInstrumentation = new BackendInstrumentation(
    memoryMetrics,
    metrics,
  );
  const service = new PostgresMemoryBackendService(
    createCrudRepoMock(repos.crud ?? {}) as MemorySegmentCrudRepository,
    createSearchRepoMock(repos.search ?? {}) as MemorySegmentSearchRepository,
    createLearningCandidateRepoMock(
      repos.learningCandidate ?? {},
    ) as MemorySegmentLearningCandidateRepository,
    backendInstrumentation,
  );
  return { service, memoryMetrics, metrics };
}

describe('PostgresMemoryBackendService', () => {
  it('persists provenance metadata when provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'segment-1' });
    const { service, memoryMetrics, metrics } = createService({
      crud: { create },
    });
    const metadata = { source: 'chat', source_id: 'message-1' };

    await service.createMemorySegment(
      'User',
      'u1',
      'remember this',
      'fact',
      metadata,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata_json: metadata }),
    );
    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'postgres',
      'success',
    );
    expect(metrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
      'postgres',
      'success',
    );
  });

  it('does not set provenance metadata when absent', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'segment-1' });
    const { service, memoryMetrics } = createService({
      crud: { create },
    });

    await service.createMemorySegment('User', 'u1', 'remember this');

    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ metadata_json: expect.anything() }),
    );
    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'postgres',
      'success',
    );
  });

  it('records a write failure outcome and rethrows when create fails', async () => {
    const { service, memoryMetrics, metrics } = createService({
      crud: { create: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    await expect(
      service.createMemorySegment('User', 'u1', 'remember this'),
    ).rejects.toThrow('boom');

    expect(memoryMetrics.recordBackendWrite).toHaveBeenCalledWith(
      'postgres',
      'failure',
    );
    expect(metrics.recordMemoryBackendWrite).toHaveBeenCalledWith(
      'postgres',
      'failure',
    );
  });

  it('records a read latency on a successful read', async () => {
    const { service, memoryMetrics, metrics } = createService({
      crud: { findByEntity: vi.fn().mockResolvedValue([{ id: 'segment-1' }]) },
    });

    const result = await service.getMemorySegments('User', 'u1');

    expect(result).toHaveLength(1);
    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'postgres',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledWith(
      'postgres',
      expect.any(Number),
    );
  });

  it('records a read latency even when the read throws', async () => {
    const { service, memoryMetrics, metrics } = createService({
      crud: {
        findByEntity: vi.fn().mockRejectedValue(new Error('read failed')),
      },
    });

    await expect(service.getMemorySegments('User', 'u1')).rejects.toThrow(
      'read failed',
    );

    expect(memoryMetrics.recordBackendRead).toHaveBeenCalledWith(
      'postgres',
      expect.any(Number),
    );
    expect(metrics.recordMemoryBackendRead).toHaveBeenCalledWith(
      'postgres',
      expect.any(Number),
    );
  });

  it('delegates promoted lesson lookup to the repository', async () => {
    const findPromotedSegmentsByScope = vi
      .fn()
      .mockResolvedValue([{ id: 'promoted-1' }]);
    const { service } = createService({
      learningCandidate: { findPromotedSegmentsByScope },
    });

    const result = await service.searchPromotedLessonsByScope({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      query: 'repair',
      limit: 5,
    });

    expect(findPromotedSegmentsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      query: 'repair',
      limit: 5,
    });
    expect(result).toEqual([{ id: 'promoted-1' }]);
  });
});
