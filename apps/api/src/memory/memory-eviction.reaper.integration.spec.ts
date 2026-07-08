/**
 * Integration test for the MemoryEvictionReaperService.
 *
 * Work item: bef49c3a-0c0f-4c85-b134-29d839c72bad.
 *
 * Milestone: "Integration Test (10 segments, 7 evicted / 3 retained)".
 *
 * Scope:
 *   This test boots a real Nest testing module around
 *   {@link MemoryEvictionReaperService} backed by a hand-rolled
 *   in-memory {@link MemorySegmentRepository} that faithfully
 *   implements the production SQL filter
 *   (`findEvictionCandidates(...)`). It also wires a fake
 *   {@link SystemSettingsService} and a fake
 *   {@link EventLedgerService}, seeds **10 memory segments across 4
 *   distinct sources**, runs the reaper, and asserts that **exactly
 *   7 rows are evicted, 3 rows are retained, and 7
 *   `memory.segment.evicted.v1` events are emitted** — one per
 *   deleted row.
 *
 * Why an in-memory repository (and not testcontainers / pg-mem):
 *   The project's integration-test convention
 *   (see `runtime-feedback.integration.spec.ts`,
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
 *   `summary.scanned` / `summary.evicted` outcome matches what the
 *   production `findEvictionCandidates(...)` query would produce
 *   against a real Postgres.
 *
 * Seed data (10 segments, 4 sources, 7 evicted / 3 retained):
 *   - `conversation` × 4
 *       * 3 old + low-access → EVICTED
 *       * 1 recently-touched → RETAINED (idle filter)
 *   - `document` × 3
 *       * 3 old + low-access → EVICTED
 *   - `learning_candidate` × 1
 *       * 1 old + low-access → RETAINED (protected-source filter)
 *   - `system` × 2
 *       * 1 old + low-access → EVICTED
 *       * 1 old + low-access + pinned → RETAINED (pinned filter)
 *
 *   Totals:
 *       scanned (post-SQL-filter candidates) = 7
 *       evicted = 7 (3 conversation + 3 document + 1 system)
 *       retained = 3 (1 conversation, 1 learning_candidate,
 *                      1 system-pinned)
 *       emitted events = 7 (one per deleted row)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryEvictionReaperService } from './memory-eviction.reaper';
import { MemorySegmentEvictionRepository } from './database/repositories/memory-segment.eviction.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { EventLedgerService } from '../observability/event-ledger.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
  MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
  MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
} from '../settings/learning-settings.constants';
import { MEMORY_SEGMENT_EVICTED_EVENT } from './memory-eviction.constants';

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
//
// The "now" the reaper uses to compute the idle-cutoff is passed
// explicitly so the test is fully deterministic (no reliance on
// wall-clock time). All seeded `last_accessed_at` / `created_at`
// timestamps are anchored relative to this fixed date so the entire
// matrix is reproducibly "old" or "recent".

const NOW = new Date('2026-06-17T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 100 days before NOW — comfortably outside the 90-day idle window. */
const OLD_DATE = new Date(NOW.getTime() - 100 * MS_PER_DAY);
/** 5 days before NOW — comfortably inside the 90-day idle window. */
const RECENT_DATE = new Date(NOW.getTime() - 5 * MS_PER_DAY);

// ---------------------------------------------------------------------------
// In-memory MemorySegmentRepository
// ---------------------------------------------------------------------------
//
// Mirrors the production SQL filter implemented in
// `MemorySegmentRepository.findEvictionCandidates(...)`:
//
//   WHERE pinned = false
//     AND (source IS NULL OR source NOT IN (:protectedSources))
//     AND access_count < :minAccessCount
//     AND (
//       (last_accessed_at IS NOT NULL AND last_accessed_at < :idleCutoff)
//       OR
//       (last_accessed_at IS NULL AND created_at < :idleCutoff)
//     )
//
// The reaper deletes each candidate row by id via `remove(id)` and
// emits one event per successful delete. The `findAll()` / `count()`
// helpers are NOT part of the reaper's surface area but are exposed
// for the test's post-run assertions on DB state.

class InMemoryMemorySegmentRepository {
  private readonly records = new Map<string, MemorySegment>();

  async findEvictionCandidates(params: {
    protectedSources: readonly string[];
    minAccessCount: number;
    idleCutoff: Date;
  }): Promise<MemorySegment[]> {
    const { protectedSources, minAccessCount, idleCutoff } = params;
    const protectedSet = new Set<string>(protectedSources);
    const cutoffMs = idleCutoff.getTime();

    return [...this.records.values()].filter((row) => {
      // archived_at IS NULL — already-archived rows are NEVER
      // re-candidates. Mirrors the production repository's
      // leading WHERE clause and the partial index
      // `idx_memory_segments_archived_at`. The decay reaper
      // (work item 3d7fb798) sets `archived_at` when a segment's
      // confidence falls below the floor; those rows are already
      // invisible to default reads via the repository's
      // `archived_at IS NULL` filter, so the eviction reaper
      // picking them up here would emit a confusing "evicted"
      // event for an already-archived row.
      if (row.archived_at !== null && row.archived_at !== undefined) {
        return false;
      }
      // pinned = false  → pinned rows are NEVER candidates.
      if (row.pinned) {
        return false;
      }
      // source IS NULL OR source NOT IN (:protectedSources)
      // The protected allowlist preserves rows whose `source` matches
      // any of the protected values (default: 'learning_candidate').
      if (row.source !== null && protectedSet.has(row.source)) {
        return false;
      }
      // access_count < :minAccessCount
      // Rows at or above the floor are load-bearing — never evicted.
      if (row.access_count >= minAccessCount) {
        return false;
      }
      // (last_accessed_at IS NOT NULL AND last_accessed_at < :idleCutoff)
      // OR
      // (last_accessed_at IS NULL AND created_at < :idleCutoff)
      const lastAccessed = row.last_accessed_at;
      if (lastAccessed !== null) {
        return lastAccessed.getTime() < cutoffMs;
      }
      return row.created_at.getTime() < cutoffMs;
    });
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
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
      created_at: data.created_at ?? OLD_DATE,
      updated_at: data.updated_at ?? OLD_DATE,
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

  async findById(id: string): Promise<MemorySegment | null> {
    return this.records.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Fake SystemSettingsService
// ---------------------------------------------------------------------------
//
// Returns the exact values the milestone spec calls out. The reaper
// resolves settings fresh on every `runOnce()` so the fake's `get()`
// must mirror the production contract — call(key, defaultValue) →
// stored value or the default.

interface FakeSystemSettings {
  get<T>(key: string, defaultValue: T): Promise<T>;
}

function createFakeSystemSettings(): FakeSystemSettings {
  const values: Record<string, unknown> = {
    [MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS]: 90,
    [MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT]: 1,
    [MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES]: ['learning_candidate'],
    memory_segment_eviction_cron: '0 3 * * *',
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
// Fake EventLedgerService
// ---------------------------------------------------------------------------
//
// Captures every `emitBestEffort(...)` invocation into an array so
// the test can assert on the event name, count, and payload shape.

interface CapturedEvent {
  domain: string;
  eventName: string;
  outcome: string;
  payload: Record<string, unknown>;
}

interface FakeEventLedger {
  emitBestEffort(params: {
    domain: string;
    eventName: string;
    outcome: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  captured: CapturedEvent[];
}

function createFakeEventLedger(): FakeEventLedger {
  const captured: CapturedEvent[] = [];
  return {
    captured,
    emitBestEffort: vi.fn(
      async (params: {
        domain: string;
        eventName: string;
        outcome: string;
        payload?: Record<string, unknown>;
      }): Promise<void> => {
        captured.push({
          domain: params.domain,
          eventName: params.eventName,
          outcome: params.outcome,
          payload: params.payload ?? {},
        });
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Test module wiring
// ---------------------------------------------------------------------------

async function buildModule(
  repository: InMemoryMemorySegmentRepository,
  settings: FakeSystemSettings,
  ledger: FakeEventLedger,
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryEvictionReaperService,
    { provide: MemorySegmentEvictionRepository, useValue: repository },
    { provide: MemorySegmentCrudRepository, useValue: repository },
    { provide: SystemSettingsService, useValue: settings },
    { provide: EventLedgerService, useValue: ledger },
  ];
  return Test.createTestingModule({ providers }).compile();
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
//
// 10 segments across 4 distinct sources. The fixture is anchored to
// `OLD_DATE` / `RECENT_DATE` (both relative to the fixed NOW) so the
// test is fully deterministic regardless of wall-clock time.

interface SeedSpec {
  id: string;
  source: 'conversation' | 'document' | 'learning_candidate' | 'system';
  last_accessed_at: Date | null;
  access_count: number;
  pinned: boolean;
  /** What the production repo's SQL filter should do with this row. */
  expectation: 'evicted' | 'retained';
  /** Why the row is retained (for assertion messages). */
  retention_reason?: string;
}

const SEED: readonly SeedSpec[] = [
  // conversation × 4: 3 evicted, 1 retained (recent)
  {
    id: 'seg-conv-old-1',
    source: 'conversation',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-conv-old-2',
    source: 'conversation',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-conv-old-3',
    source: 'conversation',
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-conv-recent',
    source: 'conversation',
    last_accessed_at: RECENT_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'retained',
    retention_reason: 'recently-touched',
  },

  // document × 3: 3 evicted
  {
    id: 'seg-doc-old-1',
    source: 'document',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-doc-old-2',
    source: 'document',
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-doc-old-3',
    source: 'document',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },

  // learning_candidate × 1: 1 retained (protected source)
  {
    id: 'seg-lc-old-1',
    source: 'learning_candidate',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'retained',
    retention_reason: 'protected-source:learning_candidate',
  },

  // system × 2: 1 evicted, 1 retained (pinned)
  {
    id: 'seg-sys-old-1',
    source: 'system',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: false,
    expectation: 'evicted',
  },
  {
    id: 'seg-sys-pinned',
    source: 'system',
    last_accessed_at: OLD_DATE,
    access_count: 0,
    pinned: true,
    expectation: 'retained',
    retention_reason: 'pinned',
  },
];

const EXPECTED_EVICTED_COUNT = SEED.filter(
  (row) => row.expectation === 'evicted',
).length;
const EXPECTED_RETAINED_COUNT = SEED.filter(
  (row) => row.expectation === 'retained',
).length;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryEvictionReaperService (integration)', () => {
  let repository: InMemoryMemorySegmentRepository;
  let settings: FakeSystemSettings;
  let ledger: FakeEventLedger;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    repository = new InMemoryMemorySegmentRepository();
    settings = createFakeSystemSettings();
    ledger = createFakeEventLedger();

    // Seed 10 segments across 4 sources.
    for (const spec of SEED) {
      await repository.create({
        id: spec.id,
        source: spec.source,
        last_accessed_at: spec.last_accessed_at,
        access_count: spec.access_count,
        pinned: spec.pinned,
        // All seeded rows have an `OLD_DATE` created_at so the
        // "never-touched" branch (`created_at < idleCutoff`) treats
        // them as candidates. The recently-touched row has a recent
        // `last_accessed_at` so the touched branch (`last_accessed_at
        // < idleCutoff`) correctly excludes it.
        created_at:
          spec.last_accessed_at === null ? OLD_DATE : spec.last_accessed_at,
      });
    }

    moduleRef = await buildModule(repository, settings, ledger);
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('seeds the expected 10 segments across 4 sources (sanity check)', async () => {
    expect(SEED).toHaveLength(10);
    const sources = new Set(SEED.map((row) => row.source));
    expect(sources.size).toBe(4);
    for (const source of [
      'conversation',
      'document',
      'learning_candidate',
      'system',
    ] as const) {
      expect(sources.has(source)).toBe(true);
    }
    expect(EXPECTED_EVICTED_COUNT).toBe(7);
    expect(EXPECTED_RETAINED_COUNT).toBe(3);
    expect(await repository.count()).toBe(10);
  });

  it('evicts exactly 7 / retains exactly 3 of 10 seeded segments', async () => {
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    // -------------------------------------------------------------------------
    // Summary assertions
    // -------------------------------------------------------------------------
    //
    // The reaper's `summary.scanned` counts the candidates returned
    // by the repository (post-SQL-filter), not the total rows in
    // the DB. With the in-memory repo faithfully reproducing the
    // production SQL filter, the 3 retained rows
    // (1 conversation recent + 1 learning_candidate + 1 system
    // pinned) are excluded from the candidate list, so:
    //
    //     scanned = 10 - 3 = 7
    //     evicted = 7
    //     skipped = 0  (the repo filter handles retention; the
    //                    reaper's per-row pinned defense never fires
    //                    because the SQL filter already excluded
    //                    pinned rows)
    //     errors  = 0
    //
    // The milestone spec describes "3 expected — the protected +
    // pinned + recently-touched ones" as a *conceptual* count of
    // retained rows; the reaper's literal `summary.skipped` field
    // is 0 because the per-row skipped branch only fires when a
    // pinned row slips past the SQL filter (see
    // memory-eviction.reaper.ts:evictOne). The DB-level assertion
    // (`repository.count() === 3`) is the canonical "3 retained"
    // check.

    expect(summary.scanned).toBe(7);
    expect(summary.evicted).toBe(7);
    expect(summary.errors).toBe(0);
    expect(summary.skipped).toBe(0);

    // -------------------------------------------------------------------------
    // DB-level assertions — the canonical 7/3 split
    // -------------------------------------------------------------------------

    const remaining = await repository.findAll();
    expect(remaining).toHaveLength(3);
    expect(await repository.count()).toBe(3);

    const retainedSpecs = SEED.filter((row) => row.expectation === 'retained');
    expect(retainedSpecs).toHaveLength(3);

    const remainingIds = new Set(remaining.map((row) => row.id));
    for (const spec of retainedSpecs) {
      expect(
        remainingIds.has(spec.id),
        `expected retained row ${spec.id} (${spec.retention_reason ?? 'n/a'}) to still be present`,
      ).toBe(true);
    }

    // Every seeded row whose expectation was 'evicted' is gone.
    const evictedSpecs = SEED.filter((row) => row.expectation === 'evicted');
    expect(evictedSpecs).toHaveLength(7);
    for (const spec of evictedSpecs) {
      const lookup = await repository.findById(spec.id);
      expect(
        lookup,
        `expected evicted row ${spec.id} (source=${spec.source}) to be removed`,
      ).toBeNull();
    }
  });

  it('emits exactly 7 memory.segment.evicted.v1 events, one per deleted row', async () => {
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    await reaper.runOnce({ now: NOW });

    // Event count + event name
    expect(ledger.captured).toHaveLength(7);
    for (const event of ledger.captured) {
      expect(event.domain).toBe('memory');
      expect(event.eventName).toBe(MEMORY_SEGMENT_EVICTED_EVENT);
      expect(MEMORY_SEGMENT_EVICTED_EVENT).toBe('memory.segment.evicted.v1');
      expect(event.outcome).toBe('success');
    }

    // Every event payload carries a valid segmentId and a non-null source.
    for (const event of ledger.captured) {
      const segmentId = event.payload['segmentId'];
      const source = event.payload['source'];
      expect(typeof segmentId).toBe('string');
      expect((segmentId as string).length).toBeGreaterThan(0);
      expect(source).not.toBeNull();
      expect(typeof source).toBe('string');
      expect((source as string).length).toBeGreaterThan(0);
    }

    // The set of emitted event segmentIds is exactly the set of
    // evicted (i.e. no longer present) seed ids — no phantom events,
    // no missed events, no events for the 3 retained rows.
    const emittedSegmentIds = ledger.captured.map(
      (event) => event.payload['segmentId'] as string,
    );
    const emittedSet = new Set(emittedSegmentIds);

    const evictedIds = SEED.filter((row) => row.expectation === 'evicted').map(
      (row) => row.id,
    );
    const retainedIds = SEED.filter(
      (row) => row.expectation === 'retained',
    ).map((row) => row.id);

    expect(emittedSet.size).toBe(7);
    for (const id of evictedIds) {
      expect(emittedSet.has(id), `expected evicted id ${id} in event set`).toBe(
        true,
      );
    }
    for (const id of retainedIds) {
      expect(
        emittedSet.has(id),
        `expected retained id ${id} to NOT appear in event set`,
      ).toBe(false);
    }

    // Per-event payload contents (segmentId / source) match the
    // corresponding seed row.
    const seedById = new Map(SEED.map((row) => [row.id, row]));
    for (const event of ledger.captured) {
      const segmentId = event.payload['segmentId'] as string;
      const source = event.payload['source'] as string;
      const seed = seedById.get(segmentId);
      expect(
        seed,
        `event emitted for unknown segmentId ${segmentId}`,
      ).toBeDefined();
      expect(source).toBe(seed?.source);
      // access_count is preserved in the payload for downstream
      // consumers (audit log, metrics, learning writeback).
      expect(event.payload['accessCount']).toBe(0);
      // evictedAt is an ISO string captured at delete time.
      expect(typeof event.payload['evictedAt']).toBe('string');
      expect((event.payload['evictedAt'] as string).length).toBeGreaterThan(0);
    }
  });

  it('reports the resolved settings on the summary (operator traceability)', async () => {
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    expect(summary.settings).toEqual({
      maxIdleDays: 90,
      minAccessCount: 1,
      protectedSources: ['learning_candidate'],
    });
    expect(summary.startedAt).toBe(NOW.toISOString());
    // finishedAt is captured from `new Date()` (wall clock) inside the
    // reaper, so it is not anchored to NOW. Assert only that it is
    // a well-formed ISO timestamp — we cannot compare it to NOW
    // because the test machine's clock may run ahead of or behind
    // the fixed test clock (NOW is 2026-06-17 and the CI box may
    // be on a different date).
    expect(summary.finishedAt).not.toBe('');
    expect(Number.isNaN(new Date(summary.finishedAt).getTime())).toBe(false);
  });

  it('is idempotent: a second run on the same DB finds no candidates', async () => {
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const first = await reaper.runOnce({ now: NOW });
    expect(first.evicted).toBe(7);

    // The ledger is captured across both runs, so snapshot the
    // length before the second run.
    const eventsAfterFirst = ledger.captured.length;

    const second = await reaper.runOnce({ now: NOW });
    expect(second.scanned).toBe(0);
    expect(second.evicted).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.errors).toBe(0);
    // No new events were emitted on the second pass.
    expect(ledger.captured.length).toBe(eventsAfterFirst);
    // The remaining 3 rows are still present.
    expect(await repository.count()).toBe(3);
  });
});
