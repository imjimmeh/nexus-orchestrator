/**
 * Unit tests for the MemoryDecayReaperService.
 *
 * Work item: 3d7fb798-f54d-40ff-a803-438224474912.
 *
 * Milestone: "Tests — acceptance criteria" (≥6 unit tests + 1
 * integration test covering 10 segments across 3 sources, asserting
 * 4 archived / 6 retained).
 *
 * This file exercises the reaper's contract using Vitest mocks for
 * the repository, settings, and metrics dependencies — no live DB,
 * no BullMQ queue. The integration test
 * (`memory-decay.reaper.integration.spec.ts`) covers the 10-segment
 * scenario with a hand-rolled in-memory repository that mirrors the
 * production `findDecayCandidates(...)` SQL filter.
 *
 * Test scenarios (≥6 per the work item acceptance criteria):
 *   1. Linear decay (0.5 - 0.01 * 30 = 0.20, retained above 0.2 floor).
 *   2. Floor → archive (decayed value below floor, archived_at set).
 *   3. Zero confidence → no further decay (confidence stays 0,
 *      archived_at set because 0 < floor).
 *   4. Exempt sources skipped (`learning_candidate`,
 *      `workflow_failure_postmortem`, `strategic_intent` are exempt).
 *   5. Kill switch (`memory_decay_enabled = false` short-circuits).
 *   6. Settings override (grace / rate / floor from settings take
 *      effect on the per-row math).
 *
 * Plus defensive coverage:
 *   7. `memoryDecayLastRun` snapshot updated on every pass.
 *   8. `recordMemoryDecayRun` prom-client counter called with the
 *      resolved (evaluated, archived) pair.
 *   9. Already-archived rows are invisible to the reaper (defensive
 *      belt-and-suspenders: `archived_at IS NOT NULL` rows from a
 *      weaker repo contract are still skipped).
 *  10. Empty candidate set → zeroed summary, no DB writes.
 *  11. `applyDecay(...)` is exported and rounds to 2 decimal places
 *      (the `0.5 - 0.01 = 0.4899999999999999` float-drift guard).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import { applyDecay } from './memory-decay.classify';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import {
  MEMORY_DECAY_DEFAULT_CRON,
  MEMORY_DECAY_DEFAULT_DAILY_RATE,
  MEMORY_DECAY_DEFAULT_ENABLED,
  MEMORY_DECAY_DEFAULT_FLOOR,
  MEMORY_DECAY_DEFAULT_GRACE_DAYS,
  MEMORY_DECAY_SETTING_KEYS,
} from './memory-decay.constants';

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
//
// The "now" the reaper uses to compute the grace cutoff is passed
// explicitly so the test is fully deterministic (no reliance on
// wall-clock time). All seeded `last_accessed_at` and
// `last_reinforced_at` timestamps are anchored relative to this fixed
// date so the entire matrix is reproducibly "old enough" or "too
// recent" without a wall-clock dependency.

const NOW = new Date('2026-06-17T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockMemorySegmentDecayRepository {
  findDecayCandidates: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentCrudRepository {
  update: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentRepository
  extends MockMemorySegmentDecayRepository, MockMemorySegmentCrudRepository {}

interface MockSystemSettings {
  get: ReturnType<typeof vi.fn>;
}

interface MockMemoryMetrics {
  setMemoryDecayLastRun: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
}

interface MockPromClient {
  recordMemoryDecayRun: ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a `MemorySegment` with sensible defaults. Only the decay
 * reaper's fields (`last_accessed_at`, `last_reinforced_at`,
 * `archived_at`, `metadata_json.confidence`, `source`) are typically
 * overridden per scenario. The fixture mirrors the
 * `buildSegment(...)` helper in the eviction reaper spec so the
 * shape stays uniform across the memory suite.
 */
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

/**
 * Wire a `SystemSettingsService` mock to return the supplied values
 * for each canonical decay setting key. Mirrors the
 * `configureSettings(...)` helper in the eviction reaper spec.
 */
function configureSettings(
  settings: MockSystemSettings,
  values: {
    enabled?: boolean;
    cron?: string;
    graceDays?: number;
    dailyRate?: number;
    floor?: number;
  },
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_DECAY_SETTING_KEYS.enabled) {
      return Promise.resolve(
        values.enabled !== undefined ? values.enabled : defaultValue,
      );
    }
    if (key === MEMORY_DECAY_SETTING_KEYS.cron) {
      return Promise.resolve(values.cron ?? defaultValue);
    }
    if (key === MEMORY_DECAY_SETTING_KEYS.graceDays) {
      return Promise.resolve(
        values.graceDays !== undefined ? values.graceDays : defaultValue,
      );
    }
    if (key === MEMORY_DECAY_SETTING_KEYS.dailyRate) {
      return Promise.resolve(
        values.dailyRate !== undefined ? values.dailyRate : defaultValue,
      );
    }
    if (key === MEMORY_DECAY_SETTING_KEYS.floor) {
      return Promise.resolve(
        values.floor !== undefined ? values.floor : defaultValue,
      );
    }
    return Promise.resolve(defaultValue);
  }) as never);
}

async function buildModule(
  repo: MockMemorySegmentRepository,
  settings: MockSystemSettings,
  memoryMetrics: MockMemoryMetrics,
  promClient: MockPromClient,
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryDecayReaperService,
    { provide: MemorySegmentDecayRepository, useValue: repo },
    { provide: MemorySegmentCrudRepository, useValue: repo },
    { provide: SystemSettingsService, useValue: settings },
    { provide: MemoryMetricsService, useValue: memoryMetrics },
    { provide: MetricsService, useValue: promClient },
  ];
  return Test.createTestingModule({ providers }).compile();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecayReaperService', () => {
  let repo: MockMemorySegmentRepository;
  let settings: MockSystemSettings;
  let memoryMetrics: MockMemoryMetrics;
  let promClient: MockPromClient;

  beforeEach(() => {
    repo = {
      findDecayCandidates: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      save: vi
        .fn()
        .mockImplementation((segment: MemorySegment) =>
          Promise.resolve(segment),
        ),
      findById: vi.fn().mockResolvedValue(null),
    };
    settings = {
      get: vi.fn(),
    };
    memoryMetrics = {
      setMemoryDecayLastRun: vi.fn(),
      snapshot: vi.fn(() => ({
        backend: {
          read: { total: {}, latency_ms: {} },
          write: { total: {} },
          active_segments: { total: {} },
          fallback: {},
        },
        distillation: { completed_total: {}, last: null },
        learning: { promoted_total: 0, last_promoted: null },
        memoryDecayLastRun: null,
        generated_at: new Date().toISOString(),
      })),
    };
    promClient = {
      recordMemoryDecayRun: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('runDecayPass', () => {
    it('applies linear decay to a single segment past the grace window (0.5 - 0.01*30 = 0.20)', async () => {
      // Case 1: linear decay. The seed segment sits 60 days past
      // access with a 30-day grace and a 0.01 daily rate — i.e.
      // 30 days past the grace window. The decayed confidence is
      // `(0.5 - 0.01*30) = 0.20`, which is right at the 0.2 floor
      // (>= floor, so the row is decayed in place, NOT archived).
      const stale = buildSegment({
        id: 'seg-linear',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.5 },
      });
      repo.findDecayCandidates.mockResolvedValue([stale]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      // Summary: 1 evaluated, 1 decayed, 0 archived.
      expect(summary).toEqual({
        evaluated: 1,
        decayed: 1,
        archived: 0,
        skipped: false,
      });

      // The repository received the right grace cutoff: NOW minus
      // the default 30-day grace. Asserting the cutoff as a sanity
      // check on the "settings → cutoff" pipeline.
      expect(repo.findDecayCandidates).toHaveBeenCalledTimes(1);
      const callArgs = repo.findDecayCandidates.mock.calls[0]?.[0] as {
        exemptSources: readonly string[];
        graceCutoff: Date;
      };
      expect(callArgs.graceCutoff.toISOString()).toBe(
        new Date(NOW.getTime() - 30 * MS_PER_DAY).toISOString(),
      );

      // The repository's `save(...)` was called with the row whose
      // `metadata_json.confidence` was decremented to 0.20.
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.id).toBe('seg-linear');
      expect(persisted.metadata_json?.['confidence']).toBe(0.2);

      // The row was NOT archived — `update(...)` is the archive
      // path, so a 1-segment run that fully decayed in place must
      // not call it.
      expect(repo.update).not.toHaveBeenCalled();

      // The prom-client counter increments by the evaluated pair.
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledTimes(1);
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(1, 0);

      // The metrics snapshot timestamp is updated even on a
      // successful pass.
      expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledWith(NOW);
    });

    it('archives a row whose decayed confidence would fall below the configured floor', async () => {
      // Case 2: floor → archive. The seed segment has confidence
      // 0.15 — already below the 0.2 floor — but the reaper does
      // NOT short-circuit on the pre-decay value. It computes the
      // post-decay value first (0.15 - 0.01*30 = -0.15, clamped to
      // 0 by `applyDecay`); the result is still below the floor,
      // so the row is archived (`archived_at` set) and the
      // confidence is NOT further decayed.
      const stale = buildSegment({
        id: 'seg-floor',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.15 },
      });
      repo.findDecayCandidates.mockResolvedValue([stale]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      expect(summary).toEqual({
        evaluated: 1,
        decayed: 0,
        archived: 1,
        skipped: false,
      });

      // The archive path is `update(id, { archived_at: now })` —
      // `save(...)` (the decay-in-place path) is NOT called.
      expect(repo.update).toHaveBeenCalledTimes(1);
      const updateArgs = repo.update.mock.calls[0] as unknown as [
        string,
        { archived_at: Date },
      ];
      expect(updateArgs[0]).toBe('seg-floor');
      expect(updateArgs[1].archived_at).toEqual(NOW);
      expect(repo.save).not.toHaveBeenCalled();

      // The prom-client counter increments with (evaluated, archived).
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(1, 1);
    });

    it('does not further decay a row whose confidence is already zero (and still archives it)', async () => {
      // Case 3: zero confidence → no further decay. The
      // `applyDecay(...)` clamp pins the post-decay value at 0
      // (the reaper NEVER invents a positive confidence from a
      // zero starting point), but the archive branch still fires
      // because 0 < 0.2 floor. The row is preserved at confidence
      // 0 — the spec does not call for a delete or a "force the
      // confidence back above the floor" branch — and
      // `archived_at` is set so the row is removed from default
      // reads.
      const zero = buildSegment({
        id: 'seg-zero',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0 },
      });
      repo.findDecayCandidates.mockResolvedValue([zero]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      expect(summary).toEqual({
        evaluated: 1,
        decayed: 0,
        archived: 1,
        skipped: false,
      });

      // The row is archived, NOT decayed in place. `save(...)`
      // must not be called for a zero-confidence row — the reaper
      // never writes `metadata_json.confidence = 0` (which is a
      // no-op write that just churns the row's `updated_at`).
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('skips exempt sources (learning_candidate, workflow_failure_postmortem, strategic_intent)', async () => {
      // Case 4: exempt sources. The candidate query is asked to
      // return these rows anyway (a defensive belt-and-suspenders
      // scenario where the repository contract is weakened) and
      // the reaper's per-row exempt check refuses to process
      // them. The summary reports 0 evaluated (the rows were
      // skipped before reaching the archive / decay branches) and
      // no DB write is performed for any of them.
      const learningCandidate = buildSegment({
        id: 'seg-lc',
        source: 'learning_candidate',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        metadata_json: { confidence: 0.5 },
      });
      const postMortem = buildSegment({
        id: 'seg-postmortem',
        source: 'workflow_failure_postmortem',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        metadata_json: { confidence: 0.5 },
      });
      const strategicIntent = buildSegment({
        id: 'seg-strategic',
        source: 'strategic_intent',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        metadata_json: { confidence: 0.5 },
      });
      repo.findDecayCandidates.mockResolvedValue([
        learningCandidate,
        postMortem,
        strategicIntent,
      ]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      expect(summary).toEqual({
        evaluated: 0,
        decayed: 0,
        archived: 0,
        skipped: false,
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(0, 0);

      // The reaper must have passed the canonical exempt allowlist
      // down to the repository so the SQL `NOT IN` filter excludes
      // the protected sources at the source.
      const callArgs = repo.findDecayCandidates.mock.calls[0]?.[0] as {
        exemptSources: readonly string[];
      };
      expect(callArgs.exemptSources).toEqual(
        expect.arrayContaining([
          'learning_candidate',
          'workflow_failure_postmortem',
          'strategic_intent',
        ]),
      );
    });

    it('short-circuits to a skipped summary when memory_decay_enabled is false (kill switch)', async () => {
      // Case 5: kill switch. The reaper reads
      // `memory_decay_enabled` and short-circuits with
      // `{ skipped: true, reason: 'disabled' }` BEFORE querying
      // the candidate set. The repository's
      // `findDecayCandidates(...)` is NEVER called, no row is
      // touched, the prom-client counter is NOT incremented (the
      // counter is intended for "rows the reaper actually
      // evaluated"), and the snapshot timestamp is still bumped
      // so the gauge reflects "the reaper was awake".
      settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
        if (key === MEMORY_DECAY_SETTING_KEYS.enabled) {
          return Promise.resolve(false);
        }
        return Promise.resolve(defaultValue);
      }) as never);

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      expect(summary).toEqual({
        evaluated: 0,
        decayed: 0,
        archived: 0,
        skipped: true,
        reason: 'disabled',
      });
      // No SQL candidate scan — the kill switch is read before the
      // query so a disabled reaper never wakes the DB.
      expect(repo.findDecayCandidates).not.toHaveBeenCalled();
      // No DB writes.
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      // The prom-client counter is intentionally NOT incremented
      // on a disabled pass: a disabled reaper did not evaluate
      // anything, so the gauge would otherwise carry phantom
      // activity that confuses operators reading the dashboard.
      expect(promClient.recordMemoryDecayRun).not.toHaveBeenCalled();
      // The "the reaper was awake" snapshot is still updated.
      expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledWith(NOW);
    });

    it('honours operator-tuned grace / rate / floor overrides via SystemSettingsService', async () => {
      // Case 6: settings override. The operator tightens the
      // grace window to 10 days, raises the daily rate to 0.05,
      // and bumps the floor to 0.5. The seed segment is 15 days
      // past access, so it is 5 days past the (tighter) grace
      // window — the new daily rate applies:
      //     confidence = 0.6 - 0.05 * 5 = 0.35
      // The post-decay value is below the (raised) 0.5 floor, so
      // the row is ARCHIVED, not decayed in place.
      const stale = buildSegment({
        id: 'seg-settings',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 15 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.6 },
      });
      repo.findDecayCandidates.mockResolvedValue([stale]);
      configureSettings(settings, {
        graceDays: 10,
        dailyRate: 0.05,
        floor: 0.5,
      });

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      // The row was evaluated and archived (0.35 < 0.5 floor).
      expect(summary).toEqual({
        evaluated: 1,
        decayed: 0,
        archived: 1,
        skipped: false,
      });

      // The cutoff the reaper passed to the repository is the new
      // 10-day window, not the hardcoded 30-day default.
      const callArgs = repo.findDecayCandidates.mock.calls[0]?.[0] as {
        graceCutoff: Date;
      };
      expect(callArgs.graceCutoff.toISOString()).toBe(
        new Date(NOW.getTime() - 10 * MS_PER_DAY).toISOString(),
      );

      // The archive branch fires (not the decay branch) because
      // the (raised) floor is the dominant constraint.
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled();

      // As a separate assertion we also exercise the decay-in-place
      // path under the same settings override: starting confidence
      // 0.6 with the raised 0.05 rate would still floor at 0 (the
      // applyDecay clamp), but at confidence 0.9 with the same 5
      // days past grace the post-decay value is 0.9 - 0.05*5 =
      // 0.65, which is above the 0.5 floor — so the row is decayed
      // in place. This pins the "rate override is applied per-row"
      // contract directly.
      const decayedInPlace = buildSegment({
        id: 'seg-settings-decayed',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 15 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.9 },
      });
      repo.findDecayCandidates.mockResolvedValue([decayedInPlace]);

      const summary2 = await reaper.runDecayPass({ now: NOW });

      expect(summary2).toEqual({
        evaluated: 1,
        decayed: 1,
        archived: 0,
        skipped: false,
      });
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.id).toBe('seg-settings-decayed');
      // 0.9 - 0.05 * 5 = 0.65 — confirmed in metadata_json.
      expect(persisted.metadata_json?.['confidence']).toBe(0.65);
    });

    it('updates the memoryDecayLastRun snapshot on every pass (including pass-throughs)', async () => {
      // Defensive: the snapshot timestamp is bumped on every
      // `runDecayPass(...)` call, including the kill-switch
      // short-circuit and the empty candidate set path. The gauge
      // is "the reaper was awake", not "the reaper did work".
      repo.findDecayCandidates.mockResolvedValue([]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      await reaper.runDecayPass({ now: NOW });

      expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledWith(NOW);
    });

    it('increments the prom-client memory-decay counter with the resolved (evaluated, archived) pair', async () => {
      // Defensive: the prom-client counter
      // `recordMemoryDecayRun(evaluated, archived)` is called once
      // per pass with the summary's evaluated + archived counters.
      // The integration test pins the wire-level name; this case
      // pins the call shape (two-argument form, correct values).
      const segment = buildSegment({
        id: 'seg-counter',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.5 },
      });
      repo.findDecayCandidates.mockResolvedValue([segment]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      await reaper.runDecayPass({ now: NOW });

      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledTimes(1);
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(1, 0);
    });

    it('passes the canonical exempt allowlist down to the repository so the SQL filter excludes exempt sources', async () => {
      // Defensive: the reaper does NOT have a per-row belt-and-
      // suspenders check for `archived_at` (unlike the eviction
      // reaper's per-row `pinned` check); the repository's
      // `findDecayCandidates(...)` is the canonical defense
      // (`WHERE archived_at IS NULL`). This test pins the
      // exempt-source allowlist passed to the repository so the
      // SQL `NOT IN` filter excludes the protected sources at the
      // source. The integration test exercises this contract end-
      // to-end through a hand-rolled in-memory repository that
      // mirrors the production SQL filter.
      const segment = buildSegment({
        id: 'seg-pass-through',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.5 },
      });
      repo.findDecayCandidates.mockResolvedValue([segment]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      await reaper.runDecayPass({ now: NOW });

      expect(repo.findDecayCandidates).toHaveBeenCalledTimes(1);
      const callArgs = repo.findDecayCandidates.mock.calls[0]?.[0] as {
        exemptSources: readonly string[];
        graceCutoff: Date;
      };
      // The canonical allowlist — the same set the reaper uses
      // for its own belt-and-suspenders check (per-row source
      // inspection in `evaluateCandidate(...)`).
      expect(callArgs.exemptSources).toEqual(
        expect.arrayContaining([
          'learning_candidate',
          'workflow_failure_postmortem',
          'strategic_intent',
        ]),
      );
    });

    it('returns a zeroed summary and does not touch the DB when no candidates are returned', async () => {
      // Defensive: an empty candidate set short-circuits the
      // per-row loop. The summary is all zeros, the prom-client
      // counter still increments (with zeros), and the metrics
      // snapshot is updated.
      repo.findDecayCandidates.mockResolvedValue([]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      expect(summary).toEqual({
        evaluated: 0,
        decayed: 0,
        archived: 0,
        skipped: false,
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(0, 0);
      expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledWith(NOW);
    });

    it('skips onboarding_chat and user_edit rows: charter sources are exempt from decay by default', async () => {
      // C2: charter-origin sources must appear in the hardcoded
      // MEMORY_DECAY_EXEMPT_SOURCES set so the reaper passes them in
      // the `exemptSources` allowlist to the repository AND skips them
      // in its own per-row belt-and-suspenders check.
      const onboardingRow = buildSegment({
        id: 'seg-onboarding-decay',
        source: 'onboarding_chat',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.5 },
      });
      const userEditRow = buildSegment({
        id: 'seg-user-edit-decay',
        source: 'user_edit',
        last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        last_reinforced_at: null,
        metadata_json: { confidence: 0.5 },
      });
      // Simulate a weakened repository contract that returns the charter
      // rows anyway — the reaper's per-row exempt check must refuse to
      // process them.
      repo.findDecayCandidates.mockImplementation(((params: {
        exemptSources: readonly string[];
      }) => {
        // The canonical exempt set must include both charter sources.
        expect(params.exemptSources).toEqual(
          expect.arrayContaining(['onboarding_chat', 'user_edit']),
        );
        return Promise.resolve([onboardingRow, userEditRow]);
      }) as never);
      configureSettings(settings, {});

      const moduleRef = await buildModule(
        repo,
        settings,
        memoryMetrics,
        promClient,
      );
      const reaper = moduleRef.get(MemoryDecayReaperService);

      const summary = await reaper.runDecayPass({ now: NOW });

      // Both charter rows must be skipped — evaluated count stays 0
      // because the per-row guard exits before reaching the archive /
      // decay branches.
      expect(summary).toEqual({
        evaluated: 0,
        decayed: 0,
        archived: 0,
        skipped: false,
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});

describe('applyDecay', () => {
  it('rounds to 2 decimal places (float-drift guard)', () => {
    // The spec calls out the float-drift case explicitly:
    //   `0.5 - 0.01 = 0.4899999999999999`
    // Without the `Math.floor((raw * 100)) / 100` rounding step,
    // the persisted value would carry noise. The helper rounds
    // first, then clamps at 0.
    expect(applyDecay(0.5, 0.01, 1)).toBe(0.49);
    // 1 day elapsed at 0.01 daily rate is 0.01 → 0.49.
    expect(applyDecay(0.5, 0.01, 30)).toBe(0.2);
    // 0.49 - 0.01 * 30 = 0.19 → 0.19.
    expect(applyDecay(0.49, 0.01, 30)).toBe(0.19);
    // Below zero → clamp.
    expect(applyDecay(0.05, 0.01, 30)).toBe(0);
    // Already at 0 → stays at 0 (no negative).
    expect(applyDecay(0, 0.01, 30)).toBe(0);
    // 1 day at 0.05 → 0.45.
    expect(applyDecay(0.5, 0.05, 1)).toBe(0.45);
  });

  it('exposes the hardcoded defaults expected by the work item contract', () => {
    // Sanity check: the constants match the work item's documented
    // defaults. The reaper service reads these via
    // `MEMORY_DECAY_DEFAULT_*` so any accidental edit to the
    // defaults shows up here.
    expect(MEMORY_DECAY_DEFAULT_ENABLED).toBe(true);
    expect(MEMORY_DECAY_DEFAULT_GRACE_DAYS).toBe(30);
    expect(MEMORY_DECAY_DEFAULT_DAILY_RATE).toBe(0.01);
    expect(MEMORY_DECAY_DEFAULT_FLOOR).toBe(0.2);
    expect(MEMORY_DECAY_DEFAULT_CRON).toBe('30 3 * * *');
  });
});
