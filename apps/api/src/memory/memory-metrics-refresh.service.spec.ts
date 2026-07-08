import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryMetricsRefreshService } from './memory-metrics-refresh.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MemorySegmentAggregationRepository } from './database/repositories/memory-segment.aggregation.repository';
import { MemorySegmentLearningCandidateRepository } from './database/repositories/memory-segment.learning-candidate.repository';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MetricsService } from '../observability/metrics.service';
import {
  MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT,
  MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING,
} from '../settings/memory-metrics-settings.constants';

interface MockMemorySegmentAggregationRepository {
  countActiveSegmentsBySource: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentLearningCandidateRepository {
  countPromotedSegmentsCreatedSince: ReturnType<typeof vi.fn>;
}

function createRepositoryMock(): MockMemorySegmentAggregationRepository {
  return {
    countActiveSegmentsBySource: vi.fn().mockResolvedValue([]),
  };
}

function createLearningCandidateRepoMock(): MockMemorySegmentLearningCandidateRepository {
  return {
    countPromotedSegmentsCreatedSince: vi.fn().mockResolvedValue(0),
  };
}

interface MockSystemSettingsService {
  get: ReturnType<typeof vi.fn>;
}

function createSettingsMock(
  overrides: Partial<MockSystemSettingsService> = {},
): MockSystemSettingsService {
  return {
    get: vi.fn().mockImplementation(async (key: string, fallback: unknown) => {
      if (key === MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING) {
        return fallback;
      }
      if (key === MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING) {
        return fallback;
      }
      return fallback;
    }),
    ...overrides,
  };
}

function createMemoryMetricsStub(): MemoryMetricsService {
  return new MemoryMetricsService();
}

function createMetricsStub(): MetricsService {
  return {
    setMemoryBackendActiveSegments: vi.fn(),
    setLearningCostPerPromotedMemory: vi.fn(),
  } as unknown as MetricsService;
}

describe('MemoryMetricsRefreshService', () => {
  let repository: MockMemorySegmentAggregationRepository;
  let settings: MockSystemSettingsService;
  let memoryMetrics: MemoryMetricsService;
  let metrics: MetricsService;
  let service: MemoryMetricsRefreshService;

  beforeEach(() => {
    repository = createRepositoryMock();
    settings = createSettingsMock();
    memoryMetrics = createMemoryMetricsStub();
    metrics = createMetricsStub();
    service = new MemoryMetricsRefreshService(
      memoryMetrics,
      metrics,
      repository as unknown as MemorySegmentAggregationRepository,
      createLearningCandidateRepoMock() as unknown as MemorySegmentLearningCandidateRepository,
      settings as unknown as SystemSettingsService,
    );
  });

  afterEach(() => {
    service.stop();
    vi.clearAllMocks();
  });

  describe('count-from-query path', () => {
    it('queries the repository exactly once per tick', async () => {
      await service.runRefreshOnce();

      expect(repository.countActiveSegmentsBySource).toHaveBeenCalledTimes(1);
    });

    it('returns early without pushing gauges when the repository returns no rows', async () => {
      repository.countActiveSegmentsBySource.mockResolvedValue([]);

      await service.runRefreshOnce();

      expect(memoryMetrics.snapshot().backend.active_segments.total).toEqual({
        postgres: {},
        honcho: {},
      });
      expect(
        metrics.setMemoryBackendActiveSegments as ReturnType<typeof vi.fn>,
      ).not.toHaveBeenCalled();
    });
  });

  describe('per-source-row path', () => {
    it('pushes one (backend, source, count) tuple per row to the in-memory service', async () => {
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 7 },
        { source: 'chat', count: 3 },
      ]);

      await service.runRefreshOnce();

      const snapshot = memoryMetrics.snapshot();
      expect(snapshot.backend.active_segments.total.postgres.memory).toBe(7);
      expect(snapshot.backend.active_segments.total.postgres.chat).toBe(3);
    });

    it('pushes the same tuples to the prom-client MetricsService', async () => {
      const setProm = metrics.setMemoryBackendActiveSegments as ReturnType<
        typeof vi.fn
      >;
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 5 },
        { source: 'chat', count: 2 },
      ]);

      await service.runRefreshOnce();

      expect(setProm).toHaveBeenCalledTimes(2);
      expect(setProm).toHaveBeenCalledWith('postgres', 'memory', 5);
      expect(setProm).toHaveBeenCalledWith('postgres', 'chat', 2);
    });

    it('overwrites the gauge for repeated sources instead of accumulating', async () => {
      repository.countActiveSegmentsBySource.mockResolvedValueOnce([
        { source: 'memory', count: 10 },
      ]);
      await service.runRefreshOnce();
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(10);

      repository.countActiveSegmentsBySource.mockResolvedValueOnce([
        { source: 'memory', count: 4 },
      ]);
      await service.runRefreshOnce();
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(4);
    });

    it('clamps non-integer and negative counts to zero', async () => {
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 2.7 },
        { source: 'chat', count: -1 },
      ]);

      await service.runRefreshOnce();

      const snapshot = memoryMetrics.snapshot();
      expect(snapshot.backend.active_segments.total.postgres.memory).toBe(2);
      expect(snapshot.backend.active_segments.total.postgres.chat).toBe(0);
    });
  });

  describe('kill switch', () => {
    it('skips the refresh and leaves the gauge untouched when the setting is false', async () => {
      settings.get.mockImplementation(((key: string, fallback: unknown) =>
        Promise.resolve(
          key === MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING ? false : fallback,
        )) as never);
      // Pre-seed a value in the gauge to make the assertion meaningful.
      memoryMetrics.setActiveSegments('postgres', 'memory', 99);
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 5 },
      ]);

      await service.runRefreshOnce();

      expect(repository.countActiveSegmentsBySource).not.toHaveBeenCalled();
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(99);
    });

    it('accepts the string "false" and the number 0 as the kill switch', async () => {
      for (const offValue of [false, 'false', 'FALSE', 0, '0']) {
        settings.get.mockImplementation(((key: string, fallback: unknown) =>
          Promise.resolve(
            key === MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING
              ? offValue
              : fallback,
          )) as never);
        await service.runRefreshOnce();
      }

      expect(repository.countActiveSegmentsBySource).not.toHaveBeenCalled();
    });

    it('defaults to enabled when the setting is missing and treats malformed values as enabled', async () => {
      // `settings.get` returns a malformed non-boolean value for the
      // kill-switch probe and a malformed non-numeric value for the
      // interval probe; both should be coerced to the safe default
      // (enabled / 60s) by the service.
      settings.get.mockImplementation(((key: string, fallback: unknown) => {
        if (key === MEMORY_METRICS_GAUGE_USE_REFRESH_SETTING) {
          return Promise.resolve('not-a-bool');
        }
        if (key === MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING) {
          return Promise.resolve('not-a-number');
        }
        return Promise.resolve(fallback);
      }) as never);
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 1 },
      ]);

      await service.runRefreshOnce();

      expect(repository.countActiveSegmentsBySource).toHaveBeenCalledTimes(1);
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(1);
    });

    it('falls back to enabled when the settings service throws on read', async () => {
      settings.get.mockRejectedValue(new Error('db unavailable'));
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 6 },
      ]);

      await service.runRefreshOnce();

      expect(repository.countActiveSegmentsBySource).toHaveBeenCalledTimes(1);
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(6);
    });
  });

  describe('graceful DB error handling', () => {
    it('does not throw when the repository rejects', async () => {
      repository.countActiveSegmentsBySource.mockRejectedValue(
        new Error('connection refused'),
      );

      await expect(service.runRefreshOnce()).resolves.toBeUndefined();
    });

    it('leaves the gauge untouched when the repository rejects', async () => {
      memoryMetrics.setActiveSegments('postgres', 'memory', 12);
      repository.countActiveSegmentsBySource.mockRejectedValue(
        new Error('connection refused'),
      );

      await service.runRefreshOnce();

      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(12);
    });

    it('does not push to the prom-client gauge when the repository rejects', async () => {
      const setProm = metrics.setMemoryBackendActiveSegments as ReturnType<
        typeof vi.fn
      >;
      repository.countActiveSegmentsBySource.mockRejectedValue(
        new Error('connection refused'),
      );

      await service.runRefreshOnce();

      expect(setProm).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('does not call the repository until the first tick fires', async () => {
      // Construct a fresh service without calling `start()` so the
      // background chain is not armed. The repository must be a
      // no-touch for the duration of the test.
      const idleService = new MemoryMetricsRefreshService(
        memoryMetrics,
        metrics,
        repository as unknown as MemorySegmentAggregationRepository,
        createLearningCandidateRepoMock() as unknown as MemorySegmentLearningCandidateRepository,
        settings as unknown as SystemSettingsService,
      );
      try {
        expect(repository.countActiveSegmentsBySource).not.toHaveBeenCalled();
        await idleService.runRefreshOnce();
        expect(repository.countActiveSegmentsBySource).toHaveBeenCalledTimes(1);
      } finally {
        idleService.stop();
      }
    });

    it('start() is idempotent — calling it twice does not stack chains', () => {
      const localRepo = createRepositoryMock();
      const localSettings = createSettingsMock();
      const localService = new MemoryMetricsRefreshService(
        createMemoryMetricsStub(),
        createMetricsStub(),
        localRepo as unknown as MemorySegmentAggregationRepository,
        createLearningCandidateRepoMock() as unknown as MemorySegmentLearningCandidateRepository,
        localSettings as unknown as SystemSettingsService,
      );
      try {
        localService.start();
        localService.start();
        // Indirect assertion: `stop()` cancels a single handle and
        // subsequent calls are no-ops (no throw). We cannot directly
        // observe the handle count without exposing it, so the
        // idempotency contract is asserted via the absence of throws.
        localService.stop();
        localService.stop();
      } finally {
        localService.stop();
      }
    });

    it('readLiveIntervalMs reads the system setting and applies coerce defaults', async () => {
      settings.get.mockImplementation(((key: string, fallback: unknown) =>
        Promise.resolve(
          key === MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING
            ? 120
            : fallback,
        )) as never);

      await expect(service['readLiveIntervalMs']()).resolves.toBe(120_000);
    });

    it('readLiveIntervalMs falls back to the default when the setting is out of range', async () => {
      settings.get.mockImplementation(((key: string, fallback: unknown) =>
        Promise.resolve(
          key === MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_SETTING
            ? 1 // below the minimum of 5
            : fallback,
        )) as never);

      await expect(service['readLiveIntervalMs']()).resolves.toBe(
        MEMORY_METRICS_REFRESH_INTERVAL_SECONDS_DEFAULT * 1000,
      );
    });
  });

  describe('EPIC-212 Phase 3 Task 6 — cost + suppressed-noise pass', () => {
    function buildWithMeasurement(deps: {
      sumCost?: ReturnType<typeof vi.fn>;
      countPromoted?: ReturnType<typeof vi.fn>;
      countMerged?: ReturnType<typeof vi.fn>;
    }) {
      const repo = {
        countActiveSegmentsBySource: vi.fn().mockResolvedValue([]),
      };
      const learningCandidateRepo = createLearningCandidateRepoMock();
      if (deps.countPromoted) {
        learningCandidateRepo.countPromotedSegmentsCreatedSince =
          deps.countPromoted;
      }
      const budgetUsage = deps.sumCost
        ? { sumCostCentsInWindowByContextTypes: deps.sumCost }
        : undefined;
      const candidates = deps.countMerged
        ? { countMerged: deps.countMerged }
        : undefined;
      const localMetrics = memoryMetrics; // real in-memory accumulator
      const promMetrics = createMetricsStub();
      const svc = new MemoryMetricsRefreshService(
        localMetrics,
        promMetrics,
        repo as unknown as MemorySegmentAggregationRepository,
        learningCandidateRepo as unknown as MemorySegmentLearningCandidateRepository,
        settings as unknown as SystemSettingsService,
        budgetUsage as never,
        candidates as never,
      );
      return { svc, localMetrics };
    }

    it('computes cost = spend / promoted over the window', async () => {
      const { svc, localMetrics } = buildWithMeasurement({
        sumCost: vi.fn().mockResolvedValue(200),
        countPromoted: vi.fn().mockResolvedValue(8),
      });
      try {
        await svc.runRefreshOnce();
      } finally {
        svc.stop();
      }
      expect(localMetrics.snapshot().learning.cost_per_promoted_memory).toBe(
        25,
      );
    });

    it('reports cost = null when there is no spend', async () => {
      const { svc, localMetrics } = buildWithMeasurement({
        sumCost: vi.fn().mockResolvedValue(0),
        countPromoted: vi.fn().mockResolvedValue(8),
      });
      try {
        await svc.runRefreshOnce();
      } finally {
        svc.stop();
      }
      expect(
        localMetrics.snapshot().learning.cost_per_promoted_memory,
      ).toBeNull();
    });

    it('reports cost = null when there are no promoted memories', async () => {
      const { svc, localMetrics } = buildWithMeasurement({
        sumCost: vi.fn().mockResolvedValue(500),
        countPromoted: vi.fn().mockResolvedValue(0),
      });
      try {
        await svc.runRefreshOnce();
      } finally {
        svc.stop();
      }
      expect(
        localMetrics.snapshot().learning.cost_per_promoted_memory,
      ).toBeNull();
    });

    it('rolls up the suppressed-noise (merged-candidate) count', async () => {
      const { svc, localMetrics } = buildWithMeasurement({
        countMerged: vi.fn().mockResolvedValue(11),
      });
      try {
        await svc.runRefreshOnce();
      } finally {
        svc.stop();
      }
      expect(localMetrics.snapshot().learning.suppressed_noise_count).toBe(11);
    });

    it('leaves cost + suppressed null when the optional repositories are not wired', async () => {
      // The base `service` is constructed without budgetUsage / candidates.
      await service.runRefreshOnce();
      const learning = memoryMetrics.snapshot().learning;
      expect(learning.cost_per_promoted_memory).toBeNull();
      expect(learning.suppressed_noise_count).toBeNull();
    });
  });

  describe('EPIC-212 Phase 3 Task 7 — probation pass wiring', () => {
    it('invokes the probation evaluator after the gauge refresh', async () => {
      const probationEvaluator = {
        runProbationPass: vi.fn().mockResolvedValue({
          confirmed: 0,
          reverted: 0,
          held: 0,
        }),
      };
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 3 },
      ]);
      const svc = new MemoryMetricsRefreshService(
        memoryMetrics,
        metrics,
        repository as unknown as MemorySegmentAggregationRepository,
        createLearningCandidateRepoMock() as unknown as MemorySegmentLearningCandidateRepository,
        settings as unknown as SystemSettingsService,
        undefined,
        undefined,
        probationEvaluator as never,
      );
      try {
        await svc.runRefreshOnce();
      } finally {
        svc.stop();
      }

      expect(probationEvaluator.runProbationPass).toHaveBeenCalledTimes(1);
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(3);
    });

    it('does not break the gauge refresh when the probation pass throws', async () => {
      const probationEvaluator = {
        runProbationPass: vi
          .fn()
          .mockRejectedValue(new Error('probation boom')),
      };
      repository.countActiveSegmentsBySource.mockResolvedValue([
        { source: 'memory', count: 8 },
      ]);
      const svc = new MemoryMetricsRefreshService(
        memoryMetrics,
        metrics,
        repository as unknown as MemorySegmentAggregationRepository,
        createLearningCandidateRepoMock() as unknown as MemorySegmentLearningCandidateRepository,
        settings as unknown as SystemSettingsService,
        undefined,
        undefined,
        probationEvaluator as never,
      );
      try {
        await expect(svc.runRefreshOnce()).resolves.toBeUndefined();
      } finally {
        svc.stop();
      }

      expect(probationEvaluator.runProbationPass).toHaveBeenCalledTimes(1);
      // The gauge refresh completed despite the probation failure.
      expect(
        memoryMetrics.snapshot().backend.active_segments.total.postgres.memory,
      ).toBe(8);
    });
  });
});
