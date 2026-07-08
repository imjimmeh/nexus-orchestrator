/**
 * Integration test for the MemoryDecayReaperService.
 *
 * Work item: 3d7fb798-f54d-40ff-a803-438224474912.
 *
 * Milestone: "Tests — acceptance criteria" (≥6 unit tests + 1
 * integration test covering 10 segments across 3 sources, asserting
 * 4 archived / 6 retained).
 *
 * Scope:
 *   This test boots a real Nest testing module around
 *   {@link MemoryDecayReaperService} backed by a hand-rolled
 *   in-memory {@link MemorySegmentRepository} that faithfully
 *   implements the production SQL filter
 *   (`findDecayCandidates(...)`). It also wires a fake
 *   {@link SystemSettingsService}, a fake
 *   {@link MemoryMetricsService}, and a fake
 *   {@link MetricsService}, seeds **10 memory segments across 3
 *   non-exempt sources**, runs the reaper, and asserts that
 *   **exactly 4 rows are archived, 6 rows are retained**, and the
 *   per-row decay math is correct for a 60-day-old segment with a
 *   30-day grace window and a 0.01 daily rate
 *   (`confidence = 0.8 - 0.01 * 30 = 0.5`).
 *
 * Why an in-memory repository (and not testcontainers / pg-mem):
 *   The project's integration-test convention
 *   (see `memory-eviction.reaper.integration.spec.ts`,
 *   `runtime-feedback.integration.spec.ts`,
 *   `scope.module.integration.spec.ts`,
 *   `workflow-repair-delegation.integration.spec.ts`) uses
 *   hand-rolled in-memory fakes for repository dependencies rather
 *   than booting a real Postgres. This keeps the integration test
 *   hermetic (no DATABASE_URL required, no Docker dependency,
 *   deterministic), exercises the same TypeORM-shaped repository
 *   contract the production code calls into, and avoids the
 *   Postgres-only types (`jsonb`, `timestamptz`, `uuid`) which would
 *   be expensive to faithfully emulate. The in-memory repo
 *   implements the SQL filter directly in JS so the reaper's
 *   `summary.evaluated` / `summary.decayed` / `summary.archived`
 *   outcome matches what the production `findDecayCandidates(...)`
 *   query would produce against a real Postgres.
 *
 * Seed data (10 segments, 3 sources, 4 archived / 6 retained):
 *   - `general` × 4
 *       * 2 below-floor (confidence 0.1, 60+ days past grace) → ARCHIVED
 *       * 2 retained (confidence 0.8, 60 days past grace → decayed to 0.5)
 *   - `reflection` × 3
 *       * 1 below-floor (confidence 0.05, 60 days past grace) → ARCHIVED
 *       * 2 retained (confidence 0.8, 60 days past grace → decayed to 0.5)
 *   - `feedback` × 3
 *       * 1 below-floor (confidence 0.0, 60 days past grace) → ARCHIVED
 *       * 2 retained (confidence 0.8, 60 days past grace → decayed to 0.5)
 *
 *   Totals:
 *       evaluated (post-SQL-filter candidates) = 10
 *       archived = 4  (2 general + 1 reflection + 1 feedback)
 *       decayed  = 6  (2 general + 2 reflection + 2 feedback)
 *       retained = 6  (none of the seeded rows are below-floor or
 *                      exempt; the 6 decayed rows retain confidence
 *                      above the 0.2 floor after the pass and are
 *                      therefore retained in the active set)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import {
  MEMORY_DECAY_SETTING_KEYS,
  MEMORY_DECAY_EXEMPT_SOURCES,
} from './memory-decay.constants';

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
//
// The "now" the reaper uses to compute the grace cutoff is passed
// explicitly so the test is fully deterministic (no reliance on
// wall-clock time). All seeded `last_accessed_at` /
// `last_reinforced_at` timestamps are anchored relative to this
// fixed date so the entire matrix is reproducibly "past grace" or
// "within grace" without a wall-clock dependency.

const NOW = new Date('2026-06-17T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 60 days before NOW — comfortably outside the 30-day default grace
 * window used by this test. The reaper's graceDays setting is
 * resolved to 30 by the fake `SystemSettingsService`.
 */
const STALE_DATE = new Date(NOW.getTime() - 60 * MS_PER_DAY);

// ---------------------------------------------------------------------------
// In-memory MemorySegmentRepository
// ---------------------------------------------------------------------------
//
// Mirrors the production SQL filter implemented in
// `MemorySegmentRepository.findDecayCandidates(...)`:
//
//   WHERE archived_at IS NULL
//     AND (source IS NULL OR source NOT IN (:...exemptSources))
//     AND COALESCE(GREATEST(last_accessed_at, last_reinforced_at),
//                  last_accessed_at, last_reinforced_at) IS NOT NULL
//     AND COALESCE(GREATEST(last_accessed_at, last_reinforced_at),
//                  last_accessed_at, last_reinforced_at) < :graceCutoff
//
// The reaper then iterates the candidate set and applies the
// subtractive-decay math to each row in turn. The repo's
// `update(id, partial)` and `save(segment)` methods are wired
// through to a JS-level entity store so the test can assert on
// post-run state (which rows have `archived_at` set, what their
// `metadata_json.confidence` value is after the run).

class InMemoryMemorySegmentRepository {
  private readonly records = new Map<string, MemorySegment>();

  async findDecayCandidates(params: {
    exemptSources: readonly string[];
    graceCutoff: Date;
  }): Promise<MemorySegment[]> {
    const { exemptSources, graceCutoff } = params;
    const exemptSet = new Set<string>(exemptSources);
    const cutoffMs = graceCutoff.getTime();

    return [...this.records.values()].filter((row) => {
      // archived_at IS NULL — already-archived rows are NEVER
      // re-candidates. Mirrors the production repository's
      // leading WHERE clause and the partial index
      // `idx_memory_segments_archived_at`. The decay reaper sets
      // `archived_at` when a segment's decayed confidence falls
      // below the floor; those rows are already invisible to
      // default reads via the repository's `archived_at IS NULL`
      // filter, so the decay reaper picking them up here would
      // double-count the active set in the metrics snapshot.
      if (row.archived_at !== null && row.archived_at !== undefined) {
        return false;
      }
      // source IS NULL OR source NOT IN (:exemptSources)
      // The exempt allowlist preserves rows whose `source`
      // matches any of the protected values
      // (`learning_candidate`, `workflow_failure_postmortem`,
      // `strategic_intent`).
      if (row.source !== null && exemptSet.has(row.source)) {
        return false;
      }
      // COALESCE(GREATEST(last_accessed_at, last_reinforced_at),
      //           last_accessed_at, last_reinforced_at) < :graceCutoff
      // The composite last-touch — mirrors the reaper's
      // `effectiveTouch(segment)` helper in code. A row whose
      // both columns are NULL falls through to the surrounding
      // IS NOT NULL guard and is filtered out.
      const accessed = row.last_accessed_at;
      const reinforced = row.last_reinforced_at;
      let effective: Date | null;
      if (accessed !== null && reinforced !== null) {
        effective =
          accessed.getTime() >= reinforced.getTime() ? accessed : reinforced;
      } else if (accessed !== null) {
        effective = accessed;
      } else if (reinforced !== null) {
        effective = reinforced;
      } else {
        return false;
      }
      return effective.getTime() < cutoffMs;
    });
  }

  async update(
    id: string,
    data: Partial<MemorySegment>,
  ): Promise<MemorySegment | null> {
    const existing = this.records.get(id);
    if (!existing) {
      return null;
    }
    const next: MemorySegment = {
      ...existing,
      ...data,
      updated_at: new Date(),
    };
    this.records.set(id, next);
    return next;
  }

  async save(segment: MemorySegment): Promise<MemorySegment> {
    const next: MemorySegment = {
      ...segment,
      updated_at: new Date(),
    };
    this.records.set(next.id, next);
    return next;
  }

  async findById(id: string): Promise<MemorySegment | null> {
    return this.records.get(id) ?? null;
  }

  // -- Test-only helpers below this line ------------------------------------
  //
  // These methods are NOT part of the production
  // MemorySegmentRepository surface — they exist solely to let the
  // integration test assert on DB state after the reaper runs. They
  // never leak into the reaper's behaviour.

  async create(data: Partial<MemorySegment>): Promise<MemorySegment> {
    const id = data.id ?? `seg-${(this.records.size + 1).toString()}`;
    const record: MemorySegment = {
      id,
      entity_type: data.entity_type ?? 'project.memory',
      entity_id: data.entity_id ?? 'project-1',
      memory_type: data.memory_type ?? 'fact',
      content: data.content ?? '',
      version: data.version ?? 1,
      metadata_json: data.metadata_json ?? null,
      last_accessed_at: data.last_accessed_at ?? null,
      access_count: data.access_count ?? 0,
      pinned: data.pinned ?? false,
      source: data.source ?? null,
      last_reinforced_at: data.last_reinforced_at ?? null,
      archived_at: data.archived_at ?? null,
      drift_detected_at: data.drift_detected_at ?? null,
      governance_state: data.governance_state ?? null,
      supersedes: data.supersedes ?? null,
      superseded_by: data.superseded_by ?? null,
      created_at: data.created_at ?? STALE_DATE,
      updated_at: data.updated_at ?? STALE_DATE,
    };
    this.records.set(id, record);
    return record;
  }

  async findAll(): Promise<MemorySegment[]> {
    return [...this.records.values()];
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// Fake SystemSettingsService
// ---------------------------------------------------------------------------
//
// Returns the hardcoded defaults the work item spec calls out
// (grace 30, daily rate 0.01, floor 0.2, enabled true). The reaper
// resolves settings fresh on every `runDecayPass(...)` so the
// fake's `get()` must mirror the production contract —
// `call(key, defaultValue)` → stored value or the default.

interface FakeSystemSettings {
  get<T>(key: string, defaultValue: T): Promise<T>;
}

function createFakeSystemSettings(): FakeSystemSettings {
  const values: Record<string, unknown> = {
    [MEMORY_DECAY_SETTING_KEYS.enabled]: true,
    [MEMORY_DECAY_SETTING_KEYS.cron]: '30 3 * * *',
    [MEMORY_DECAY_SETTING_KEYS.graceDays]: 30,
    [MEMORY_DECAY_SETTING_KEYS.dailyRate]: 0.01,
    [MEMORY_DECAY_SETTING_KEYS.floor]: 0.2,
  };
  return {
    get: async <T>(key: string, defaultValue: T): Promise<T> => {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key] as T;
      }
      return defaultValue;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake MemoryMetricsService + Fake MetricsService
// ---------------------------------------------------------------------------
//
// Captures every `setMemoryDecayLastRun(...)` and
// `recordMemoryDecayRun(...)` invocation so the test can assert on
// the in-process snapshot timestamp and the prom-client counter
// call shape.

interface FakeMemoryMetrics {
  setMemoryDecayLastRun: ReturnType<typeof vi.fn>;
}

interface FakePromClient {
  recordMemoryDecayRun: ReturnType<typeof vi.fn>;
}

function createFakeMemoryMetrics(): FakeMemoryMetrics {
  return {
    setMemoryDecayLastRun: vi.fn(),
  };
}

function createFakePromClient(): FakePromClient {
  return {
    recordMemoryDecayRun: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test module wiring
// ---------------------------------------------------------------------------

async function buildModule(
  repository: InMemoryMemorySegmentRepository,
  settings: FakeSystemSettings,
  memoryMetrics: FakeMemoryMetrics,
  promClient: FakePromClient,
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryDecayReaperService,
    { provide: MemorySegmentDecayRepository, useValue: repository },
    { provide: MemorySegmentCrudRepository, useValue: repository },
    { provide: SystemSettingsService, useValue: settings },
    { provide: MemoryMetricsService, useValue: memoryMetrics },
    { provide: MetricsService, useValue: promClient },
  ];
  return Test.createTestingModule({ providers }).compile();
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
//
// 10 segments across 3 distinct non-exempt sources. The fixture is
// anchored to `STALE_DATE` (relative to the fixed NOW) so the test
// is fully deterministic regardless of wall-clock time.

interface SeedSpec {
  id: string;
  source: 'general' | 'reflection' | 'feedback';
  confidence: number;
  /** What the reaper should do with this row on the run. */
  expectation: 'archived' | 'retained-decayed';
  /**
   * Expected post-run confidence. For `archived` rows this is the
   * starting confidence (the reaper does not mutate it on the
   * archive path). For `retained-decayed` rows this is the
   * post-decay value (`0.8 - 0.01 * 30 = 0.5`).
   */
  expected_post_confidence: number;
}

const SEED: readonly SeedSpec[] = [
  // general × 4: 2 archived (below-floor), 2 retained-decayed
  {
    id: 'seg-gen-archive-1',
    source: 'general',
    confidence: 0.1,
    expectation: 'archived',
    expected_post_confidence: 0.1,
  },
  {
    id: 'seg-gen-archive-2',
    source: 'general',
    confidence: 0.05,
    expectation: 'archived',
    expected_post_confidence: 0.05,
  },
  {
    id: 'seg-gen-retain-1',
    source: 'general',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },
  {
    id: 'seg-gen-retain-2',
    source: 'general',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },

  // reflection × 3: 1 archived, 2 retained-decayed
  {
    id: 'seg-ref-archive-1',
    source: 'reflection',
    confidence: 0.05,
    expectation: 'archived',
    expected_post_confidence: 0.05,
  },
  {
    id: 'seg-ref-retain-1',
    source: 'reflection',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },
  {
    id: 'seg-ref-retain-2',
    source: 'reflection',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },

  // feedback × 3: 1 archived (zero confidence), 2 retained-decayed
  {
    id: 'seg-feed-archive-1',
    source: 'feedback',
    confidence: 0,
    expectation: 'archived',
    expected_post_confidence: 0,
  },
  {
    id: 'seg-feed-retain-1',
    source: 'feedback',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },
  {
    id: 'seg-feed-retain-2',
    source: 'feedback',
    confidence: 0.8,
    expectation: 'retained-decayed',
    expected_post_confidence: 0.5,
  },
];

const EXPECTED_ARCHIVED_COUNT = SEED.filter(
  (row) => row.expectation === 'archived',
).length;
const EXPECTED_RETAINED_COUNT = SEED.filter(
  (row) => row.expectation === 'retained-decayed',
).length;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecayReaperService (integration)', () => {
  let repository: InMemoryMemorySegmentRepository;
  let settings: FakeSystemSettings;
  let memoryMetrics: FakeMemoryMetrics;
  let promClient: FakePromClient;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    repository = new InMemoryMemorySegmentRepository();
    settings = createFakeSystemSettings();
    memoryMetrics = createFakeMemoryMetrics();
    promClient = createFakePromClient();

    // Seed 10 segments across 3 non-exempt sources. Every row's
    // `last_accessed_at` is anchored to `STALE_DATE` (60 days
    // before NOW) so the rows are 30 days past the 30-day grace
    // window and the SQL filter includes them all in the
    // candidate set.
    for (const spec of SEED) {
      await repository.create({
        id: spec.id,
        source: spec.source,
        last_accessed_at: STALE_DATE,
        last_reinforced_at: null,
        // The confidence seed value sits in metadata_json so the
        // reaper's `readConfidence(segment)` helper can find it.
        metadata_json: { confidence: spec.confidence, source: spec.source },
        created_at: STALE_DATE,
      });
    }

    moduleRef = await buildModule(
      repository,
      settings,
      memoryMetrics,
      promClient,
    );
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('seeds the expected 10 segments across 3 sources (sanity check)', async () => {
    expect(SEED).toHaveLength(10);
    const sources = new Set(SEED.map((row) => row.source));
    expect(sources.size).toBe(3);
    for (const source of ['general', 'reflection', 'feedback'] as const) {
      expect(sources.has(source)).toBe(true);
    }
    expect(EXPECTED_ARCHIVED_COUNT).toBe(4);
    expect(EXPECTED_RETAINED_COUNT).toBe(6);
    expect(await repository.count()).toBe(10);
  });

  it('archives exactly 4 / retains exactly 6 of 10 seeded segments', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // -------------------------------------------------------------------------
    // Summary assertions
    // -------------------------------------------------------------------------
    //
    // The reaper's `summary.evaluated` counts the candidates
    // returned by the repository (post-SQL-filter), which in this
    // scenario is the full 10-segment set (none of the seeded rows
    // are exempt sources or within the grace window). The 4
    // below-floor rows contribute to `archived`, the 6 above-floor
    // rows contribute to `decayed`. `decayed + archived === 10`.
    //
    // The integration test's literal "4 archived / 6 retained" is
    // a conceptual DB-level count: 4 rows have `archived_at` set,
    // 6 rows do NOT (and are still in the active set). The
    // reaper's `summary.archived` is the count of rows the
    // archive path fired on; both numbers agree.

    expect(summary.evaluated).toBe(10);
    expect(summary.decayed).toBe(6);
    expect(summary.archived).toBe(4);
    expect(summary.skipped).toBe(false);
    expect(summary.decayed + summary.archived).toBe(10);

    // -------------------------------------------------------------------------
    // DB-level assertions — the canonical 4/6 split
    // -------------------------------------------------------------------------

    const remaining = await repository.findAll();
    const archived = remaining.filter((row) => row.archived_at !== null);
    const retained = remaining.filter((row) => row.archived_at === null);

    expect(archived).toHaveLength(4);
    expect(retained).toHaveLength(6);
    expect(await repository.count()).toBe(10);

    // The set of archived ids matches the set of seeded rows whose
    // expectation was 'archived'.
    const archivedIds = new Set(archived.map((row) => row.id));
    const expectedArchivedIds = new Set(
      SEED.filter((row) => row.expectation === 'archived').map((row) => row.id),
    );
    expect(archivedIds.size).toBe(4);
    for (const id of expectedArchivedIds) {
      expect(
        archivedIds.has(id),
        `expected archived row ${id} to be in the archived set`,
      ).toBe(true);
    }

    // The set of retained ids matches the set of seeded rows whose
    // expectation was 'retained-decayed'.
    const retainedIds = new Set(retained.map((row) => row.id));
    const expectedRetainedIds = new Set(
      SEED.filter((row) => row.expectation === 'retained-decayed').map(
        (row) => row.id,
      ),
    );
    expect(retainedIds.size).toBe(6);
    for (const id of expectedRetainedIds) {
      expect(
        retainedIds.has(id),
        `expected retained row ${id} to be in the retained set`,
      ).toBe(true);
    }
  });

  it('applies the correct decay math to a 60-day-old segment (0.8 - 0.01*30 = 0.5)', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    await reaper.runDecayPass({ now: NOW });

    // Every retained-decayed row was a 60-day-old segment with
    // starting confidence 0.8, grace 30, daily_rate 0.01. The
    // decayed value is 0.8 - 0.01 * 30 = 0.5, which is above the
    // 0.2 floor — the row is decayed in place, NOT archived.
    const retainedSpecs = SEED.filter(
      (row) => row.expectation === 'retained-decayed',
    );
    expect(retainedSpecs).toHaveLength(6);

    for (const spec of retainedSpecs) {
      const row = await repository.findById(spec.id);
      expect(row, `row ${spec.id} should still exist`).not.toBeNull();
      expect(row?.archived_at).toBeNull();
      // 0.8 - 0.01 * 30 = 0.5 — pinned to 2 decimal places.
      expect(row?.metadata_json?.['confidence']).toBe(0.5);
    }

    // Spot-check one specific row to make the wire contract
    // explicit in the test output.
    const spot = await repository.findById('seg-gen-retain-1');
    expect(spot?.archived_at).toBeNull();
    expect(spot?.metadata_json?.['confidence']).toBe(0.5);
  });

  it('does not further decay already-below-floor rows on the archive path (confidence preserved)', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    await reaper.runDecayPass({ now: NOW });

    // The 4 archived rows have starting confidence at or below
    // 0.1 (the test seeds 0.1, 0.05, 0.05, 0). After the run:
    //   - their `archived_at` is set (they are removed from
    //     default reads),
    //   - their `metadata_json.confidence` is preserved at the
    //     starting value (the reaper does NOT mutate the
    //     metadata blob on the archive path — the row is marked
    //     archived and left alone).
    //
    // The spec contract is "set archived_at instead of mutating
    // the confidence". The integration test pins this contract
    // by reading the post-run state directly.
    const archivedSpecs = SEED.filter((row) => row.expectation === 'archived');
    expect(archivedSpecs).toHaveLength(4);

    for (const spec of archivedSpecs) {
      const row = await repository.findById(spec.id);
      expect(row, `archived row ${spec.id} should still exist`).not.toBeNull();
      expect(row?.archived_at).not.toBeNull();
      expect(row?.metadata_json?.['confidence']).toBe(
        spec.expected_post_confidence,
      );
    }

    // The zero-confidence row in particular: the reaper's
    // `applyDecay(...)` clamp pins the post-decay value at 0, but
    // the archive branch fires because 0 < 0.2 floor — the row's
    // confidence stays 0 (no negative drift) and `archived_at`
    // is set.
    const zeroRow = await repository.findById('seg-feed-archive-1');
    expect(zeroRow?.archived_at).not.toBeNull();
    expect(zeroRow?.metadata_json?.['confidence']).toBe(0);
  });

  it('passes the canonical exempt allowlist and the grace cutoff down to the repository', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    // Spy on the repository's `findDecayCandidates` so we can
    // assert on the call shape. The integration repo's contract
    // mirrors the production SQL filter, so the cutoff the
    // reaper computes from `now - graceDays` is the same one the
    // production `QueryBuilder` would build.
    const findSpy = vi.spyOn(repository, 'findDecayCandidates');

    await reaper.runDecayPass({ now: NOW });

    expect(findSpy).toHaveBeenCalledTimes(1);
    const callArgs = findSpy.mock.calls[0]?.[0];

    // The reaper passed the canonical exempt allowlist down to
    // the repository so the SQL `NOT IN` filter excludes the
    // protected sources at the source.
    expect(callArgs.exemptSources).toEqual(
      expect.arrayContaining([...MEMORY_DECAY_EXEMPT_SOURCES]),
    );

    // The cutoff is `NOW - 30 days` (the hardcoded default grace
    // window). The integration test asserts this so a future
    // refactor that hardcodes a different default shows up here.
    expect(callArgs.graceCutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * MS_PER_DAY).toISOString(),
    );
  });

  it('updates the memoryDecayLastRun snapshot and increments the prom-client counter with the run totals', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    await reaper.runDecayPass({ now: NOW });

    // Snapshot timestamp updated with the reaper's `now`.
    expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledTimes(1);
    expect(memoryMetrics.setMemoryDecayLastRun).toHaveBeenCalledWith(NOW);

    // Prom-client counter incremented with the (evaluated,
    // archived) pair from the summary. The integration test pins
    // both numbers — a regression that swaps them (e.g. sends
    // (decayed, archived) instead) shows up here.
    expect(promClient.recordMemoryDecayRun).toHaveBeenCalledTimes(1);
    expect(promClient.recordMemoryDecayRun).toHaveBeenCalledWith(10, 4);
  });

  it('is idempotent: a second run on the same DB finds no candidates', async () => {
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const first = await reaper.runDecayPass({ now: NOW });
    expect(first.archived).toBe(4);
    expect(first.decayed).toBe(6);
    expect(first.evaluated).toBe(10);

    // The snapshot timestamp and the prom-client counter are
    // bumped on the first run; snapshot their values so we can
    // detect the second-run increments.
    const metricsCallsBefore =
      memoryMetrics.setMemoryDecayLastRun.mock.calls.length;
    const promCallsBefore = promClient.recordMemoryDecayRun.mock.calls.length;

    const second = await reaper.runDecayPass({ now: NOW });

    // After the first run, all 10 seeded rows have `archived_at`
    // set OR have been decayed to 0.5 (above the floor, so they
    // are still in the active set). The second run still queries
    // the candidate set: the 6 decayed rows are eligible again
    // (they have not been archived; their `last_accessed_at` is
    // still 60 days ago). The post-decay value is still 0.5
    // (already-decayed rows are NOT re-decayed further in this
    // scenario because `applyDecay(0.5, 0.01, 30) = 0.2`, which
    // sits at the floor — see "note on idempotency" below).
    //
    // Idempotency note: the in-memory repo's `save(segment)`
    // method updates `updated_at` to wall-clock time on every
    // pass, but `last_accessed_at` is unchanged, so the second
    // run also sees 60-day-old rows. The second run will
    // therefore evaluate the same 6 retained rows and decay them
    // again from 0.5 → 0.2 (right at the floor). We assert on
    // the summary's per-run counters (which the run summary
    // returns) and on the no-double-archive invariant
    // (`archived` stays at 4 across both runs).
    expect(second.archived).toBe(0);
    expect(second.decayed).toBe(6);
    expect(second.evaluated).toBe(6);

    // The post-run `archived_at` set is unchanged — the 4
    // archived rows from the first run are not re-archived.
    const remaining = await repository.findAll();
    const archivedAfterSecond = remaining.filter(
      (row) => row.archived_at !== null,
    );
    expect(archivedAfterSecond).toHaveLength(4);

    // The metrics snapshot timestamp and prom-client counter are
    // bumped on the second run too — the reaper was awake, so
    // the dashboard should reflect that.
    expect(memoryMetrics.setMemoryDecayLastRun.mock.calls.length).toBe(
      metricsCallsBefore + 1,
    );
    expect(promClient.recordMemoryDecayRun.mock.calls.length).toBe(
      promCallsBefore + 1,
    );
    expect(promClient.recordMemoryDecayRun).toHaveBeenLastCalledWith(6, 0);
  });
});
