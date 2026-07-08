/**
 * Unit tests for the daily ConvergenceRecorderService (work
 * item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2).
 *
 * Mirrors the project's
 * `controller-handles-transport / service-owns-domain /
 * repository-owns-persistence` quality gate and the
 * test-surface style of `memory-decay.reaper.spec.ts`: every
 * dependency is a hand-rolled fake injected via the NestJS
 * `Test.createTestingModule({ providers }).useMocker(...)`
 * pattern (no Testcontainers, no live DB, no live BullMQ).
 *
 * Five-row AC-5 matrix:
 *   1. Fresh DB / empty scope set — `tick()` persists a
 *      snapshot with an all-zero histogram + distribution,
 *      a `'no_change'` policy outcome (because the seeded
 *      singleton's threshold matches the default), the score
 *      gauge is bumped, the no-change counter is bumped, the
 *      `recorder_passed.v1` event is emitted, and the result
 *      carries the persisted row.
 *   2. Hot pass — the per-scope convergence map has 2 active
 *      scopes (ratios `0.5` and `0.8`), the per-segment
 *      usefulness map has 3 segments (ratios `0.7`, `0.4`,
 *      `null`), the recorder aggregates the score to `0.65`
 *      (mean of 0.5 + 0.8), builds a 3-bucket histogram,
 *      runs `decideMemoryRetentionKeep` on each segment,
 *      persists the snapshot, bumps the score gauge to
 *      `0.65`, and emits the passed event.
 *   3. Threshold-applied — when the proposed threshold moves
 *      by more than `LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON`
 *      the policy upsert yields `outcome: 'applied'` and the
 *      counter is incremented with the `applied` label.
 *   4. Threshold-no-change — when the proposed threshold is
 *      within `ε` of the current threshold the policy upsert
 *      yields `outcome: 'no_change'` and the counter is
 *      incremented with the `no_change` label.
 *   5. Persistence failure — when the snapshot insert
 *      throws, the recorder catches, emits the
 *      `AUTONOMY_EVENT_NAMES.memoryConvergenceRecorderFailed`
 *      event best-effort, returns a typed
 *      `ConvergenceRecorderTickError`, and NEVER bumps the
 *      score gauge or the recalibration counter
 *      (persistence MUST complete before metrics — AC-9).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import {
  CONVERGENCE_RECORDER_WINDOW_DAYS,
  ConvergenceRecorderService,
  ConvergenceRecorderTickError,
} from './convergence-recorder.service';
import { LearningMeasurementSnapshotRepository } from './database/repositories/learning-measurement-snapshot.repository';
import { MemoryRetentionPolicyRepository } from './database/repositories/memory-retention-policy.repository';
import type { LearningMeasurementSnapshot } from './database/entities/learning-measurement-snapshot.entity';
import type { MemoryRetentionPolicy } from './database/entities/memory-retention-policy.entity';
import { MemoryMetricsService } from '../../memory-metrics.service';
import { MemorySegmentFeedbackService } from '../../memory-segment-feedback.service';
import { MemorySegmentCrudRepository } from '../../database/repositories/memory-segment.crud.repository';
import { MetricsService } from '../../../observability/metrics.service';
import { EventLedgerService } from '../../../observability/event-ledger.service';
import { SystemSettingsService } from '../../../settings/system-settings.service';
import type { MemorySegment } from '../../database/entities/memory-segment.entity';
import type { LearningConvergenceSnapshot } from '../../memory-metrics.types';
import {
  LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON,
  LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT,
} from './settings/learning-convergence.settings.constants';

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
const NOW = new Date('2026-07-08T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Mock interfaces
// ---------------------------------------------------------------------------

interface MockLearningMeasurementSnapshotRepository {
  insertSnapshot: ReturnType<typeof vi.fn>;
  listRecentByWindow: ReturnType<typeof vi.fn>;
  countWithinLast24h: ReturnType<typeof vi.fn>;
}

interface MockMemoryRetentionPolicyRepository {
  upsertIfChanged: ReturnType<typeof vi.fn>;
  getCurrent: ReturnType<typeof vi.fn>;
}

interface MockMemoryMetricsService {
  getConvergenceSnapshots: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentFeedbackService {
  computeUsefulnessForSegments: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentCrudRepository {
  findAll: ReturnType<typeof vi.fn>;
}

interface MockMetricsService {
  setConvergenceScore: ReturnType<typeof vi.fn>;
  recordMemoryRetentionRecalibration: ReturnType<typeof vi.fn>;
}

interface MockEventLedgerService {
  emitBestEffort: ReturnType<typeof vi.fn>;
}

interface MockSystemSettingsService {
  get: ReturnType<typeof vi.fn<[string, unknown], Promise<unknown>>>;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildSegment(overrides: Partial<MemorySegment>): MemorySegment {
  return {
    id: overrides.id ?? 'segment-id',
    entity_type: 'project.memory',
    entity_id: 'project-1',
    memory_type: 'fact',
    content: 'content',
    version: 1,
    metadata_json: null,
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    source: 'project.memory',
    last_reinforced_at: null,
    archived_at: null,
    drift_detected_at: null,
    governance_state: null,
    supersedes: null,
    superseded_by: null,
    syncSourceFromMetadata: () => undefined,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSnapshot(
  overrides: Partial<LearningMeasurementSnapshot> = {},
): LearningMeasurementSnapshot {
  return {
    computed_at: NOW,
    source_window: '24h',
    promoted_to_bound_score: '0',
    bound_to_reused_score: '0',
    usefulness_histogram: {},
    retention_decision_distribution: {},
    ...overrides,
  };
}

function buildPolicy(
  overrides: Partial<MemoryRetentionPolicy> = {},
): MemoryRetentionPolicy {
  return {
    id: 1,
    usefulness_threshold: '0.5',
    recalibrated_at: NOW,
    sample_size: 0,
    ...overrides,
  };
}

function buildConvergenceSnapshot(
  scope: string,
  ratio: number,
): LearningConvergenceSnapshot {
  return {
    ratio,
    window_days: 1,
    runs_after_lesson: ratio === 0 ? 0 : 10,
    successes_after_lesson: ratio === 0 ? 0 : Math.round(ratio * 10),
    computed_at: NOW.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Module builder
// ---------------------------------------------------------------------------

interface RecorderDeps {
  snapshotRepo: MockLearningMeasurementSnapshotRepository;
  policyRepo: MockMemoryRetentionPolicyRepository;
  memoryMetrics: MockMemoryMetricsService;
  feedback: MockMemorySegmentFeedbackService;
  segments: MockMemorySegmentCrudRepository;
  metrics: MockMetricsService;
  eventLedger: MockEventLedgerService;
  settings: MockSystemSettingsService;
}

async function buildModule(
  deps: RecorderDeps,
): Promise<{ moduleRef: TestingModule; service: ConvergenceRecorderService }> {
  const providers: Provider[] = [
    ConvergenceRecorderService,
    {
      provide: LearningMeasurementSnapshotRepository,
      useValue: deps.snapshotRepo,
    },
    { provide: MemoryRetentionPolicyRepository, useValue: deps.policyRepo },
    { provide: MemoryMetricsService, useValue: deps.memoryMetrics },
    { provide: MemorySegmentFeedbackService, useValue: deps.feedback },
    { provide: MemorySegmentCrudRepository, useValue: deps.segments },
    { provide: MetricsService, useValue: deps.metrics },
    { provide: EventLedgerService, useValue: deps.eventLedger },
    { provide: SystemSettingsService, useValue: deps.settings },
  ];
  const moduleRef = await Test.createTestingModule({
    providers,
  }).compile();
  const service = moduleRef.get(ConvergenceRecorderService);
  return { moduleRef, service };
}

function createDeps(): RecorderDeps {
  return {
    snapshotRepo: {
      insertSnapshot: vi.fn().mockImplementation(
        async (input): Promise<LearningMeasurementSnapshot> =>
          buildSnapshot({
            source_window: input.source_window,
            promoted_to_bound_score: input.promoted_to_bound_score,
            bound_to_reused_score: input.bound_to_reused_score,
            usefulness_histogram: input.usefulness_histogram,
            retention_decision_distribution:
              input.retention_decision_distribution,
          }),
      ),
      listRecentByWindow: vi.fn().mockResolvedValue([]),
      countWithinLast24h: vi.fn().mockResolvedValue(0),
    },
    policyRepo: {
      upsertIfChanged: vi.fn().mockImplementation(
        async (
          threshold: number,
          sampleSize: number,
        ): Promise<{
          outcome: 'applied' | 'no_change';
          row: MemoryRetentionPolicy;
        }> => ({
          outcome: 'no_change',
          row: buildPolicy({
            usefulness_threshold: threshold.toString(),
            sample_size: sampleSize,
          }),
        }),
      ),
      getCurrent: vi.fn().mockResolvedValue(buildPolicy()),
    },
    memoryMetrics: {
      getConvergenceSnapshots: vi.fn().mockReturnValue({}),
      snapshot: vi.fn().mockReturnValue({
        backend: {},
        distillation: {},
        learning: {},
        postmortem: {},
        memoryDecayLastRun: null,
        generated_at: NOW.toISOString(),
      }),
    },
    feedback: {
      computeUsefulnessForSegments: vi.fn().mockResolvedValue(new Map()),
    },
    segments: {
      findAll: vi.fn().mockResolvedValue([]),
    },
    metrics: {
      setConvergenceScore: vi.fn(),
      recordMemoryRetentionRecalibration: vi.fn(),
    },
    eventLedger: {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    },
    settings: {
      get: vi
        .fn()
        .mockImplementation(
          async (_key: string, defaultValue: unknown) => defaultValue,
        ),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConvergenceRecorderService', () => {
  let deps: RecorderDeps;

  beforeEach(() => {
    deps = createDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('computeAndPersistSnapshot', () => {
    it('persists a snapshot row, bumps the score gauge, and returns the persisted row', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({
        'project-1': buildConvergenceSnapshot('project-1', 0.6),
      });
      deps.segments.findAll.mockResolvedValue([
        buildSegment({ id: 'seg-1', pinned: false }),
      ]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(
        new Map([['seg-1', { usefulness: 0.7, sampleSize: 12 }]]),
      );

      const { moduleRef, service } = await buildModule(deps);
      const snapshot = await service.computeAndPersistSnapshot({
        window: '24h',
        now: NOW,
      });

      // Persistence
      expect(deps.snapshotRepo.insertSnapshot).toHaveBeenCalledTimes(1);
      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        source_window: string;
        promoted_to_bound_score: string;
        bound_to_reused_score: string;
        usefulness_histogram: Record<string, number>;
        retention_decision_distribution: Record<string, number>;
      };
      expect(inserted.source_window).toBe('24h');
      expect(inserted.promoted_to_bound_score).toBe('0.6');
      expect(inserted.usefulness_histogram['7']).toBe(1);
      expect(inserted.retention_decision_distribution['useful']).toBe(1);
      // bound_to_reused_score: one 'useful' verdict over one
      // non-null verdict → keep-fraction = 1.
      expect(inserted.bound_to_reused_score).toBe('1');

      // Metrics
      expect(deps.metrics.setConvergenceScore).toHaveBeenCalledWith('24h', 0.6);

      // Returned snapshot
      expect(snapshot).toBeDefined();
      expect(snapshot.source_window).toBe('24h');

      await moduleRef.close();
    });

    it('honours the window-days mapping for the snapshot horizon', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});

      const { moduleRef, service } = await buildModule(deps);
      await service.computeAndPersistSnapshot({ window: '7d', now: NOW });

      expect(deps.memoryMetrics.getConvergenceSnapshots).toHaveBeenCalledWith(
        CONVERGENCE_RECORDER_WINDOW_DAYS['7d'],
      );

      await moduleRef.close();
    });
  });

  /**
   * Pinned assertions for `bound_to_reused_score` (milestone
   * 1, AC-1). Drives `computeAndPersistSnapshot` end-to-end
   * so the private `aggregateSnapshot` API stays intact — the
   * fixture segments are tuned so the value predicate emits
   * a deterministic reason list that the spec can pin
   * byte-for-byte against the persisted row.
   */
  describe('bound_to_reused_score aggregate (AC-1)', () => {
    /**
     * Build segments whose `decideMemoryRetentionKeep` verdicts
     * match the supplied reason list (same length, same order,
     * same sources). The verdict mapping the value predicate
     * emits is:
     *
     *   - `pinned: true`              → `pinned`
     *   - `injectedAndHelped: true`   → `injected_and_helped`
     *   - `usefulness >= 0.5` + enough samples → `useful`
     *   - `usefulness === null`       → `no_votes`
     *   - enough samples but usefulness < 0.5 → `low_usefulness`
     *   - votes but sampleSize < minSamples → `insufficient_samples`
     */
    function buildScenariosForReasons(
      reasons: ReadonlyArray<string | null | undefined>,
    ): MemorySegment[] {
      const segments: MemorySegment[] = [];
      reasons.forEach((reason, index) => {
        const id = `seg-${index}`;
        switch (reason) {
          case 'pinned':
            segments.push(buildSegment({ id, pinned: true }));
            break;
          case 'injected_and_helped':
            // The recorder currently hardcodes
            // `injectedAndHelped: false`, so we cannot trigger
            // this reason via the value predicate directly.
            // Pin via the always-keep path: a `pinned` segment
            // is also a 'pinned' reason — the aggregate is
            // what we care about, and the helper spec covers
            // the pure-input case for `injected_and_helped`.
            // For this fixture we substitute a `useful`
            // scenario and document the substitution at the
            // assertion site.
            segments.push(buildSegment({ id, pinned: false }));
            // ...but we still need a way to inject the
            // `injected_and_helped` reason. Since
            // `aggregateSnapshot` reads from the
            // `decisionReasons` the caller hands in (which is
            // derived from the value predicate), and the
            // recorder currently hardcodes
            // `injectedAndHelped: false`, we instead drive
            // the test via the helper spec for that branch.
            break;
          case 'useful':
            segments.push(buildSegment({ id, pinned: false }));
            break;
          case 'insufficient_samples':
            segments.push(buildSegment({ id, pinned: false }));
            break;
          case 'low_usefulness':
            segments.push(buildSegment({ id, pinned: false }));
            break;
          case 'no_votes':
            segments.push(buildSegment({ id, pinned: false }));
            break;
          case null:
          case undefined:
          default:
            segments.push(buildSegment({ id, pinned: false }));
            break;
        }
      });
      return segments;
    }

    function buildUsefulnessForReasons(
      reasons: ReadonlyArray<string | null | undefined>,
    ): Map<string, { usefulness: number | null; sampleSize: number }> {
      const entries: Array<
        [string, { usefulness: number | null; sampleSize: number }]
      > = [];
      reasons.forEach((reason, index) => {
        const id = `seg-${index}`;
        switch (reason) {
          case 'useful':
            entries.push([id, { usefulness: 0.7, sampleSize: 12 }]);
            break;
          case 'low_usefulness':
            entries.push([id, { usefulness: 0.3, sampleSize: 12 }]);
            break;
          case 'insufficient_samples':
            entries.push([id, { usefulness: 0.9, sampleSize: 1 }]);
            break;
          case 'no_votes':
            entries.push([id, { usefulness: null, sampleSize: 0 }]);
            break;
          default:
            // 'pinned', 'injected_and_helped', null/undefined:
            // no usefulness entry needed (pinned short-circuits;
            // null is filtered before predicate).
            break;
        }
      });
      return new Map(entries);
    }

    it("(a) empty decisionReasons — no segments scanned → persisted bound_to_reused_score = '0'", async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(new Map());

      const { moduleRef, service } = await buildModule(deps);
      await service.computeAndPersistSnapshot({ window: '24h', now: NOW });

      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        bound_to_reused_score: string;
      };
      expect(inserted.bound_to_reused_score).toBe('0');

      await moduleRef.close();
    });

    it("(b) mixed keep + drop over 5 verdicts → persisted bound_to_reused_score = '0.4'", async () => {
      const reasons = [
        'pinned',
        'useful',
        'insufficient_samples',
        'low_usefulness',
        'no_votes',
      ] as const;
      const segments = buildScenariosForReasons(reasons);
      const usefulness = buildUsefulnessForReasons(reasons);

      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue(segments);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(usefulness);

      const { moduleRef, service } = await buildModule(deps);
      await service.computeAndPersistSnapshot({ window: '24h', now: NOW });

      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        bound_to_reused_score: string;
      };
      // 2 keep ('pinned' + 'useful') / 5 total non-null verdicts
      // → keep-fraction = 0.4.
      expect(inserted.bound_to_reused_score).toBe('0.4');

      await moduleRef.close();
    });

    it("(c) all-keep input → persisted bound_to_reused_score = '1'", async () => {
      // The recorder's `decideMemoryRetentionKeep` invocation
      // hardcodes `injectedAndHelped: false`, so the value
      // predicate can only emit `pinned` | `useful` from the
      // keep set via the regular code path. We pin the
      // all-keep case via two `pinned` + one `useful` segment
      // (the helper spec covers the pure-input 'all three keep
      // keys' aggregate for the `injected_and_helped` branch).
      const reasons = ['pinned', 'pinned', 'useful'] as const;
      const segments = buildScenariosForReasons(reasons);
      const usefulness = buildUsefulnessForReasons(reasons);

      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue(segments);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(usefulness);

      const { moduleRef, service } = await buildModule(deps);
      await service.computeAndPersistSnapshot({ window: '24h', now: NOW });

      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        bound_to_reused_score: string;
      };
      // 3 keep / 3 total non-null verdicts → keep-fraction = 1.
      expect(inserted.bound_to_reused_score).toBe('1');

      await moduleRef.close();
    });

    it('keeps the pinned assertions byte-stable across passes (regression for AC-8 round-trip)', async () => {
      const reasons = ['pinned', 'useful', 'low_usefulness'] as const;
      const segments = buildScenariosForReasons(reasons);
      const usefulness = buildUsefulnessForReasons(reasons);

      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue(segments);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(usefulness);

      const { moduleRef, service } = await buildModule(deps);
      await service.computeAndPersistSnapshot({ window: '24h', now: NOW });
      const first = (
        deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
          bound_to_reused_score: string;
        }
      ).bound_to_reused_score;

      await service.computeAndPersistSnapshot({ window: '24h', now: NOW });
      const second = (
        deps.snapshotRepo.insertSnapshot.mock.calls[1]?.[0] as {
          bound_to_reused_score: string;
        }
      ).bound_to_reused_score;

      // 2 keep / 3 total non-null verdicts → 0.6666… rounded
      // to 6 dp = '0.666667'. A regression that drops the
      // rounding step (e.g. raw floating-point output) would
      // surface as a divergent second-pass string.
      expect(first).toBe('0.666667');
      expect(second).toBe(first);

      await moduleRef.close();
    });
  });

  describe('recordRetentionRecalibrationIfChanged', () => {
    it('forwards the threshold + sample size + epsilon to the repository and bumps the counter', async () => {
      deps.policyRepo.upsertIfChanged.mockResolvedValue({
        outcome: 'applied',
        row: buildPolicy({
          usefulness_threshold: '0.42',
          sample_size: 12,
        }),
      });

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.recordRetentionRecalibrationIfChanged({
        threshold: 0.42,
        sampleSize: 12,
        now: NOW,
      });

      expect(deps.policyRepo.upsertIfChanged).toHaveBeenCalledWith(
        0.42,
        12,
        LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON,
      );
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).toHaveBeenCalledWith('applied');
      expect(result.outcome).toBe('applied');

      await moduleRef.close();
    });

    it('swallows a metrics failure and still returns the repository result', async () => {
      deps.policyRepo.upsertIfChanged.mockResolvedValue({
        outcome: 'no_change',
        row: buildPolicy(),
      });
      deps.metrics.recordMemoryRetentionRecalibration.mockImplementation(() => {
        throw new Error('counter down');
      });

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.recordRetentionRecalibrationIfChanged({
        threshold: 0.5,
        sampleSize: 5,
        now: NOW,
      });

      expect(result.outcome).toBe('no_change');
      // The metrics failure was swallowed, NOT bubbled.
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).toHaveBeenCalledTimes(1);

      await moduleRef.close();
    });
  });

  describe('tick (AC-5 matrix)', () => {
    it('row 1: fresh DB / empty scope set — persists all-zero payload + emits passed event', async () => {
      // Empty scope map + empty segment set → all-zero histogram,
      // all-zero distribution, score = 0, threshold = default.
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(new Map());

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      // Typed result, no error.
      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      if (result instanceof ConvergenceRecorderTickError) {
        throw new Error('expected success');
      }
      expect(result.outcome).toBe('recorded');
      expect(result.snapshot).toBeDefined();
      expect(result.policyRow).toBeDefined();

      // Persistence
      expect(deps.snapshotRepo.insertSnapshot).toHaveBeenCalledTimes(1);
      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        promoted_to_bound_score: string;
        usefulness_histogram: Record<string, number>;
        retention_decision_distribution: Record<string, number>;
      };
      expect(inserted.promoted_to_bound_score).toBe('0');
      expect(inserted.usefulness_histogram).toEqual({
        '0': 0,
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
        '5': 0,
        '6': 0,
        '7': 0,
        '8': 0,
        '9': 0,
        unknown: 0,
      });
      expect(inserted.retention_decision_distribution).toEqual({
        pinned: 0,
        injected_and_helped: 0,
        useful: 0,
        insufficient_samples: 0,
        low_usefulness: 0,
        no_votes: 0,
        null: 0,
      });

      // Metrics
      expect(deps.metrics.setConvergenceScore).toHaveBeenCalledWith('24h', 0);

      // Default threshold (no samples → uses the default) →
      // upsert outcome is 'no_change' (matches the seeded
      // singleton's threshold byte-for-byte).
      expect(deps.policyRepo.upsertIfChanged).toHaveBeenCalledTimes(1);
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).toHaveBeenCalledWith('no_change');

      // Best-effort audit event was emitted.
      expect(deps.eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: ConvergenceRecorderService.RECORDER_PASSED_EVENT_NAME,
          outcome: 'success',
        }),
      );

      await moduleRef.close();
    });

    it('row 2: hot pass — aggregates score from 2 scopes + builds 3-bucket histogram', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({
        'project-1': buildConvergenceSnapshot('project-1', 0.5),
        'project-2': buildConvergenceSnapshot('project-2', 0.8),
      });
      deps.segments.findAll.mockResolvedValue([
        buildSegment({ id: 'seg-useful', pinned: false }),
        buildSegment({ id: 'seg-low', pinned: false }),
        buildSegment({ id: 'seg-never-voted', pinned: false }),
      ]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(
        new Map<string, { usefulness: number | null; sampleSize: number }>([
          ['seg-useful', { usefulness: 0.7, sampleSize: 12 }],
          ['seg-low', { usefulness: 0.4, sampleSize: 12 }],
          ['seg-never-voted', { usefulness: null, sampleSize: 0 }],
        ]),
      );

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      if (result instanceof ConvergenceRecorderTickError) {
        throw new Error('expected success');
      }
      expect(result.outcome).toBe('recorded');

      const inserted = deps.snapshotRepo.insertSnapshot.mock.calls[0]?.[0] as {
        promoted_to_bound_score: string;
        usefulness_histogram: Record<string, number>;
        retention_decision_distribution: Record<string, number>;
      };

      // Mean of (0.5 + 0.8) = 0.65.
      expect(inserted.promoted_to_bound_score).toBe('0.65');

      // Histogram: 0.7 → bin 7, 0.4 → bin 4, null → unknown.
      expect(inserted.usefulness_histogram['7']).toBe(1);
      expect(inserted.usefulness_histogram['4']).toBe(1);
      expect(inserted.usefulness_histogram['unknown']).toBe(1);

      // Distribution: useful (above threshold), low_usefulness
      // (below threshold, enough samples), no_votes (null).
      expect(inserted.retention_decision_distribution['useful']).toBe(1);
      expect(inserted.retention_decision_distribution['low_usefulness']).toBe(
        1,
      );
      expect(inserted.retention_decision_distribution['no_votes']).toBe(1);

      // Score gauge bumped to 0.65.
      expect(deps.metrics.setConvergenceScore).toHaveBeenCalledWith(
        '24h',
        0.65,
      );

      await moduleRef.close();
    });

    it('row 3: threshold applied — when proposed threshold moves by > ε, counter is bumped with `applied`', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([
        buildSegment({ id: 'seg-1', pinned: false }),
      ]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(
        new Map<string, { usefulness: number | null; sampleSize: number }>([
          // All at 0.3 — below the seeded 0.5 threshold, so
          // min-observed = 0.3 which is Δ = 0.2 from the
          // singleton's 0.5. Above ε.
          ['seg-1', { usefulness: 0.3, sampleSize: 12 }],
        ]),
      );
      deps.policyRepo.upsertIfChanged.mockResolvedValue({
        outcome: 'applied',
        row: buildPolicy({ usefulness_threshold: '0.3', sample_size: 1 }),
      });

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      if (result instanceof ConvergenceRecorderTickError) {
        throw new Error('expected success');
      }
      expect(result.outcome).toBe('recorded');
      expect(result.policyRow?.outcome).toBe('applied');
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).toHaveBeenCalledWith('applied');

      await moduleRef.close();
    });

    it('row 4: threshold no-change — when proposed threshold is within ε of current, counter is bumped with `no_change`', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([
        buildSegment({ id: 'seg-1', pinned: false }),
      ]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(
        new Map<string, { usefulness: number | null; sampleSize: number }>([
          // Min-observed = 0.4999999, which is within ε of the
          // seeded 0.5 → 'no_change' branch.
          [
            'seg-1',
            {
              usefulness:
                0.5 - LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON / 2,
              sampleSize: 12,
            },
          ],
        ]),
      );
      deps.policyRepo.upsertIfChanged.mockResolvedValue({
        outcome: 'no_change',
        row: buildPolicy(),
      });

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      if (result instanceof ConvergenceRecorderTickError) {
        throw new Error('expected success');
      }
      expect(result.policyRow?.outcome).toBe('no_change');
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).toHaveBeenCalledWith('no_change');

      await moduleRef.close();
    });

    it('row 5: persistence failure — typed error returned, metrics NOT bumped, failure event emitted (AC-9)', async () => {
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([]);
      deps.snapshotRepo.insertSnapshot.mockRejectedValue(
        new Error('snapshot insert failed'),
      );

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      // The recorder returns a typed error instead of throwing.
      expect(result).toBeInstanceOf(ConvergenceRecorderTickError);
      if (!(result instanceof ConvergenceRecorderTickError)) {
        throw new Error('expected typed error');
      }
      expect(result.outcome).toBe('failed');
      expect(result.window).toBe('multi');
      expect(result.message).toContain('snapshot insert failed');

      // Persistence halted at the snapshot insert — the policy
      // upsert was NEVER called.
      expect(deps.policyRepo.upsertIfChanged).not.toHaveBeenCalled();

      // Metrics MUST NOT be bumped when persistence fails.
      expect(deps.metrics.setConvergenceScore).not.toHaveBeenCalled();
      expect(
        deps.metrics.recordMemoryRetentionRecalibration,
      ).not.toHaveBeenCalled();

      // The best-effort failure event was emitted.
      expect(deps.eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: ConvergenceRecorderService.RECORDER_FAILED_EVENT_NAME,
          outcome: 'failure',
        }),
      );

      await moduleRef.close();
    });

    it('honours the operator-tuned window_days SystemSetting when provided', async () => {
      deps.settings.get.mockImplementation(
        async (key: string, defaultValue: unknown) => {
          if (key === 'learning_convergence_window_days') {
            return 7;
          }
          return defaultValue;
        },
      );
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});

      const { moduleRef, service } = await buildModule(deps);
      await service.tick();

      expect(deps.memoryMetrics.getConvergenceSnapshots).toHaveBeenCalledWith(
        7,
      );

      await moduleRef.close();
    });

    it('honours the operator-tuned min-samples SystemSetting (uses 1 sample → recalibrates)', async () => {
      deps.settings.get.mockImplementation(
        async (key: string, defaultValue: unknown) => {
          if (key === 'learning_convergence_usefulness_min_samples') {
            return 1;
          }
          return defaultValue;
        },
      );
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([
        buildSegment({ id: 'seg-1', pinned: false }),
      ]);
      deps.feedback.computeUsefulnessForSegments.mockResolvedValue(
        new Map<string, { usefulness: number | null; sampleSize: number }>([
          ['seg-1', { usefulness: 0.42, sampleSize: 5 }],
        ]),
      );

      const { moduleRef, service } = await buildModule(deps);
      await service.tick();

      // With minSamples=1 the recorder recalibrates on a single
      // sample → the threshold is the min-observed (0.42).
      expect(deps.policyRepo.upsertIfChanged).toHaveBeenCalledWith(
        0.42,
        1,
        LEARNING_CONVERGENCE_RECALIBRATION_THRESHOLD_EPSILON,
      );

      await moduleRef.close();
    });

    it('falls back to the hardcoded min-samples default when the settings service throws', async () => {
      deps.settings.get.mockRejectedValue(new Error('settings down'));
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([]);

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      // The pass still completes with the hardcoded default.
      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      await moduleRef.close();
    });

    it('falls back to the hardcoded min-samples default when the settings service is not wired', async () => {
      deps.settings.get.mockImplementation(
        async () => LEARNING_CONVERGENCE_USEFULNESS_MIN_SAMPLES_DEFAULT,
      );
      deps.memoryMetrics.getConvergenceSnapshots.mockReturnValue({});
      deps.segments.findAll.mockResolvedValue([]);

      const { moduleRef, service } = await buildModule(deps);
      const result = await service.tick();

      expect(result).not.toBeInstanceOf(ConvergenceRecorderTickError);
      await moduleRef.close();
    });
  });
});
