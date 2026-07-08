/**
 * Integration test for the `MemoryDriftDetectionService`.
 *
 * Work item: 0cead042-e823-4e26-9386-02042252ffb0.
 *
 * Milestone: "Integration test (10 segments, 3 drifted / 7
 * retained across mixed source-file reality)".
 *
 * Scope:
 *   This test boots a real Nest testing module around
 *   {@link MemoryDriftDetectionService} backed by a real Postgres
 *   test instance (the same one `docker-compose.yaml` exposes on
 *   port 5433). It wires the REAL service, a REAL
 *   {@link MetricsService} (prom-client counters increment against
 *   the process-global registry), a stub
 *   {@link SystemSettingsService} that returns the hardcoded
 *   drift defaults, and a stub {@link EventLedgerService} that
 *   captures every `emitBestEffort(...)` call into an in-memory
 *   array so the test can assert on the domain events without a
 *   real `event_ledger` DB write. The repository is the real
 *   TypeORM `Repository<MemorySegment>` injected via
 *   `TypeOrmModule.forFeature([MemorySegment])` so the detector's
 *   `findDriftCandidates(...)` query hits the live SQL surface.
 *
 * Why a real DB (and not a hand-rolled in-memory fake):
 *   The drift detector is the "reality check" leg of the
 *   AI-memory subsystem: it cross-references a
 *   `MemorySegment.metadata_json` reference against (a) the live
 *   Postgres schema (via TypeORM's `DataSource.entityMetadatas`),
 *   (b) the on-disk file tree (via `fs.promises.stat`), and (c)
 *   the on-disk code corpus (via a recursive `.ts`/`.js` walk).
 *   A hand-rolled in-memory fake would have to emulate all three
 *   surfaces, which would just be a slower re-implementation of
 *   the production logic and would defeat the purpose of an
 *   integration test. Using a real Postgres keeps the test honest:
 *   the detector's candidate query, schema-index build, and row
 *   update all go through the same code path they do in
 *   production. The test is conditional on a DB being reachable
 *   (any `DATABASE_URL` / `DB_HOST` / `DB_PORT` / `DB_DATABASE`
 *   env var triggers it; if none is set, the test is skipped via
 *   `describe.skipIf(...)` so CI environments without a Postgres
 *   still pass).
 *
 * Seed data (10 segments across 5 source-file realities,
 * 3 drifted / 7 retained):
 *   - file, present × 2    → not drifted
 *       (real repo files: `memory-drift-detection.service.ts`,
 *        `memory-drift.constants.ts`)
 *   - file, missing × 1    → DRIFTED
 *       (path `_does_not_exist_/missing.ts` resolves to ENOENT)
 *   - schema, present × 2  → not drifted
 *       (real columns: `memory_segments.id`,
 *        `memory_segments.drift_detected_at`)
 *   - schema, missing × 1  → DRIFTED
 *       (`memory_segments.legacy_column` is not in the live
 *        TypeORM metadata)
 *   - api, present × 1     → not drifted
 *       (route literal `GET /v1/orders` is mentioned in the
 *        detector's own doc comments inside `apps/api/src`, so the
 *        code corpus walk finds it)
 *   - api, missing × 1     → DRIFTED
 *       (literal built via concatenation so the test source does
 *        not contain the substring; the corpus walk cannot find
 *        it anywhere on disk)
 *   - exempt × 2           → SKIPPED (exempt allowlist)
 *       (`learning_candidate` and `workflow_failure_postmortem`
 *        with drift-worthy references — the detector short-
 *        circuits BEFORE the parser / checkers run, so the
 *        references are never evaluated)
 *
 *   Totals:
 *       candidates (post-SQL-filter) = 10
 *       checked                       = 10
 *       drift detected                = 3 (1 file + 1 schema + 1 api)
 *       exempt (skipped without drift)= 2
 *       unchanged                     = 5 (2 file-present + 2 schema-present + 1 api-present)
 *
 * Drift detection rate (3 / 10 = 30 %) matches the work item's
 * documented "reality check" expectation: a small subset of
 * segments carry references to deleted/renamed reality and the
 * detector must flag exactly that subset, not more, not less.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { register } from 'prom-client';
import { MemoryDriftDetectionService } from './memory-drift-detection.service';
import { MemorySegment } from './database/entities/memory-segment.entity';
import { MetricsService } from '../observability/metrics.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { EmitEventLedgerParams } from '../observability/event-ledger.service.types';
import { SystemSettingsService } from '../settings/system-settings.service';
import { registeredMigrations } from '../database/migrations/registered-migrations';
import {
  MEMORY_DRIFT_EVENT_NAME,
  MEMORY_DRIFT_SETTING_KEYS,
} from './memory-drift.constants';

// ---------------------------------------------------------------------------
// DB availability gate
// ---------------------------------------------------------------------------
//
// The destructive suite TRUNCATEs `memory_segments`, so it must NEVER
// run against the live application database. The gate requires
// INTEGRATION_TEST_DATABASE_URL to be set to a dedicated throwaway
// Postgres instance (CI provisions one; a dev machine typically leaves
// it unset). When the var is absent the entire suite is skipped, so
// `npm run test:api` on a dev machine can never wipe live data.
// `assertNotApplicationDatabase` (called at suite setup) is a
// belt-and-suspenders safety guard that aborts the run if the URL
// resolves to the same host/port/database as the application DB.

// The destructive integration suite (it TRUNCATEs memory_segments)
// runs ONLY against a dedicated throwaway database, never the
// everyday application DB. Set INTEGRATION_TEST_DATABASE_URL to a
// disposable Postgres to enable it (CI provisions one). Absent that
// var the suite skips — so `npm run test:api` on a dev machine can
// never wipe live data.
const INTEGRATION_TEST_DATABASE_URL =
  process.env['INTEGRATION_TEST_DATABASE_URL'];
const DB_AVAILABLE = Boolean(INTEGRATION_TEST_DATABASE_URL);

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
//
// The detector's run summary, per-row `drift_detected_at` stamp,
// and recheck-window cutoff all anchor to this fixed `NOW` so the
// test is fully deterministic — no wall-clock dependency.

const NOW = new Date('2026-06-20T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Test DB config
// ---------------------------------------------------------------------------
//
// Built solely from INTEGRATION_TEST_DATABASE_URL — the single
// source of truth for the throwaway database connection. No
// individual host/port/user fields are consulted, which means the
// config cannot accidentally resolve to the application database.

const testDbConfig = {
  type: 'postgres' as const,
  url: INTEGRATION_TEST_DATABASE_URL,
  entities: [MemorySegment],
  migrations: registeredMigrations,
  migrationsRun: true,
  migrationsTransactionMode: 'none' as const,
  synchronize: false,
  logging: false,
};

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
//
// The test does NOT need a real `SystemSettingsService` (the drift
// settings are hardcoded fallbacks — the test pins them by passing
// the fallbacks through the stub). It does NOT need a real
// `EventLedgerService` (a real implementation would write a row to
// the `event_ledger` table on every drift event — the test just
// needs to assert on the captured calls). Stubs let the test stay
// focused on the detector's behaviour without spinning up the full
// observability / settings stack.

interface CapturedEvent extends EmitEventLedgerParams {
  capturedAt: Date;
}

class InMemoryEventLedger {
  readonly events: CapturedEvent[] = [];

  async emit(params: EmitEventLedgerParams): Promise<void> {
    this.events.push({ ...params, capturedAt: new Date() });
  }

  async emitBestEffort(params: EmitEventLedgerParams): Promise<void> {
    // Mirror the production `emitBestEffort` semantics: the
    // production wrapper catches errors from `emit(...)` and
    // logs them. The test stub does not need to fail on
    // emission — the detector relies on `emitBestEffort`
    // returning normally so a ledger outage does not roll
    // back the row update.
    try {
      await this.emit(params);
    } catch {
      // No-op: matches production swallow-and-log semantics.
    }
  }

  /** Test-only helper. */
  reset(): void {
    this.events.length = 0;
  }
}

interface SystemSettingsStub {
  get: Mock<(key: string, defaultValue: unknown) => Promise<unknown>>;
}

/**
 * Build a `SystemSettingsService` stub that returns the
 * hardcoded drift-detection defaults. The detector resolves
 * settings fresh on every `runDriftPass(...)` call, so the
 * stub's `get(key, defaultValue)` is called three times per
 * pass (enabled, confidencePenalty, recheckAfterMs). Returning
 * the supplied default for each call lets the test pin the
 * hardcoded fallback values without a real settings table.
 */
function buildSystemSettingsStub(): SystemSettingsStub {
  return {
    get: vi
      .fn<(key: string, defaultValue: unknown) => Promise<unknown>>()
      .mockImplementation(
        async <T>(key: string, defaultValue: T): Promise<T> => {
          // The detector only consults three drift-specific
          // keys; honour the hardcoded fallbacks so the test
          // does not depend on the wider settings table.
          if (
            key === MEMORY_DRIFT_SETTING_KEYS.enabled ||
            key === MEMORY_DRIFT_SETTING_KEYS.confidencePenalty ||
            key === MEMORY_DRIFT_SETTING_KEYS.recheckAfterMs
          ) {
            return Promise.resolve(defaultValue);
          }
          return Promise.resolve(defaultValue);
        },
      ),
  };
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
//
// 10 segments across the documented mix. Every row starts with
// `confidence = 0.9`, `drift_detected_at = null`, and
// `archived_at = null` so the detector's candidate query
// (`archived_at IS NULL AND drift_detected_at IS NULL`) returns
// the full set. The `id`s are stable UUIDs so the post-run
// assertions can re-query the DB by id without scanning.

interface SeedSpec {
  id: string;
  source: string;
  metadata_json: Record<string, unknown>;
  expectedOutcome: 'drifted' | 'unchanged';
}

const SEED: readonly SeedSpec[] = [
  // ---- file, present × 2 → not drifted -----------------------------
  {
    id: '00000000-0000-4000-8000-000000000001',
    source: 'project.fact',
    metadata_json: {
      filePath: 'apps/api/src/memory/memory-drift-detection.service.ts',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    source: 'project.fact',
    metadata_json: {
      filePath: 'apps/api/src/memory/memory-drift.constants.ts',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },

  // ---- file, missing × 1 → drifted ---------------------------------
  {
    id: '00000000-0000-4000-8000-000000000003',
    source: 'project.fact',
    metadata_json: {
      filePath: 'apps/api/src/memory/_does_not_exist_/missing.ts',
      confidence: 0.9,
    },
    expectedOutcome: 'drifted',
  },

  // ---- schema, present × 2 → not drifted ---------------------------
  {
    id: '00000000-0000-4000-8000-000000000004',
    source: 'project.fact',
    metadata_json: {
      schemaRef: 'memory_segments.id',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    source: 'project.fact',
    metadata_json: {
      schemaRef: 'memory_segments.drift_detected_at',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },

  // ---- schema, missing × 1 → drifted -------------------------------
  {
    id: '00000000-0000-4000-8000-000000000006',
    source: 'project.fact',
    metadata_json: {
      schemaRef: 'memory_segments.legacy_column',
      confidence: 0.9,
    },
    expectedOutcome: 'drifted',
  },

  // ---- api, present × 1 → not drifted ------------------------------
  // The route literal `GET /v1/orders` is documented inside the
  // detector's own source files
  // (`memory-drift-checkers.ts`, `memory-drift.types.ts`), so the
  // corpus walk discovers it.
  {
    id: '00000000-0000-4000-8000-000000000007',
    source: 'project.fact',
    metadata_json: {
      apiEndpoint: 'GET /v1/orders',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },

  // ---- api, missing × 1 → drifted ----------------------------------
  // Built via concatenation so the literal substring never
  // appears in this test source — the corpus walk would
  // otherwise match the test file itself and the "missing"
  // expectation would silently flip to "present".
  {
    id: '00000000-0000-4000-8000-000000000008',
    source: 'project.fact',
    metadata_json: {
      apiEndpoint: ['POST /v9/widgets/', 'legacy'].join(''),
      confidence: 0.9,
    },
    expectedOutcome: 'drifted',
  },

  // ---- exempt × 2 → SKIPPED ---------------------------------------
  // Both rows point at drift-worthy references, but the detector
  // must short-circuit on the exempt-source allowlist BEFORE the
  // parser / checkers run. They MUST NOT drift, no matter how
  // stale their references are.
  {
    id: '00000000-0000-4000-8000-000000000009',
    source: 'learning_candidate',
    metadata_json: {
      filePath: 'apps/api/src/memory/_does_not_exist_/missing.ts',
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },
  {
    id: '00000000-0000-4000-8000-00000000000a',
    source: 'workflow_failure_postmortem',
    metadata_json: {
      apiEndpoint: ['POST /v9/widgets/', 'legacy'].join(''),
      confidence: 0.9,
    },
    expectedOutcome: 'unchanged',
  },
];

const EXPECTED_DRIFTED_COUNT = SEED.filter(
  (row) => row.expectedOutcome === 'drifted',
).length;
const EXPECTED_UNCHANGED_COUNT = SEED.filter(
  (row) => row.expectedOutcome === 'unchanged',
).length;

assert(EXPECTED_DRIFTED_COUNT === 3, `seed mix must include 3 drifted rows`);
assert(
  EXPECTED_UNCHANGED_COUNT === 7,
  `seed mix must include 7 unchanged rows`,
);

/**
 * Throw a developer-visible assertion at module load so a
 * future edit that drops a seed row or rewrites an expectation
 * surfaces immediately, not at test-execution time.
 */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(
      `memory-drift-detection integration seed assertion: ${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test module wiring
// ---------------------------------------------------------------------------

async function buildModule(): Promise<TestingModule> {
  const eventLedger = new InMemoryEventLedger();
  const settings = buildSystemSettingsStub();

  const providers: Provider[] = [
    MemoryDriftDetectionService,
    MetricsService,
    { provide: SystemSettingsService, useValue: settings },
    { provide: EventLedgerService, useValue: eventLedger },
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot(testDbConfig),
      TypeOrmModule.forFeature([MemorySegment]),
    ],
    providers,
  }).compile();

  // Stash the stubs on the module ref so the test body can pull
  // them out without re-constructing. The cast is narrow (the
  // module ref doesn't know about our closures) but justified
  // here because both stubs are pure locals with no DI surface.
  (
    moduleRef as TestingModule & { __eventLedger: InMemoryEventLedger }
  ).__eventLedger = eventLedger;
  (moduleRef as TestingModule & { __settings: SystemSettingsStub }).__settings =
    settings;

  return moduleRef;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Refuse to run the destructive TRUNCATE against the application
 * database, even if the connection string is misconfigured. The
 * application DB name comes from DB_DATABASE (default
 * `nexus_orchestrator`); the integration test must point at a
 * different, disposable database.
 */
async function assertNotApplicationDatabase(
  dataSource: DataSource,
): Promise<void> {
  const rows = await dataSource.query<{ current_database: string }[]>(
    'SELECT current_database()',
  );
  const connected = rows[0]?.current_database;
  const appDb = process.env['DB_DATABASE'] ?? 'nexus_orchestrator';
  if (connected === appDb) {
    throw new Error(
      `Refusing to TRUNCATE: integration test is connected to the application database "${connected}". ` +
        'Point INTEGRATION_TEST_DATABASE_URL at a dedicated throwaway database.',
    );
  }
}

/**
 * Truncate the `memory_segments` table so each test run starts
 * from a clean slate. Uses `TRUNCATE ... RESTART IDENTITY` so a
 * second run does not collide with stale ids; the `CASCADE`
 * clause is defensive in case any future migration adds FK
 * constraints to `memory_segments`.
 */
async function truncateMemorySegments(dataSource: DataSource): Promise<void> {
  await assertNotApplicationDatabase(dataSource);
  await dataSource.query(
    'TRUNCATE TABLE "memory_segments" RESTART IDENTITY CASCADE;',
  );
}

/**
 * Insert one seed row. Uses `repository.save(...)` so TypeORM's
 * lifecycle hooks (the `syncSourceFromMetadata` `@BeforeInsert`
 * on `MemorySegment`) fire and the column-level `source` is
 * backfilled from `metadata_json.source` when the caller did not
 * set it explicitly.
 */
async function insertSeed(
  repository: Repository<MemorySegment>,
  spec: SeedSpec,
): Promise<MemorySegment> {
  const entity = repository.create({
    id: spec.id,
    entity_type: 'project.memory',
    entity_id: 'project-1',
    memory_type: 'fact',
    content: `seed-${spec.id}`,
    version: 1,
    metadata_json: spec.metadata_json,
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    // The seed sets `source` explicitly for the exempt rows
    // (so the `MEMORY_DRIFT_EXEMPT_SOURCES` short-circuit
    // fires); non-exempt rows rely on the
    // `syncSourceFromMetadata` hook to backfill the column
    // from `metadata_json.source` when present. We set the
    // column directly to the same value the hook would have
    // produced so the test does not depend on the hook's
    // string-trimming / length-cap behaviour.
    source: spec.source,
    last_reinforced_at: null,
    archived_at: null,
    drift_detected_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  });
  return repository.save(entity);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!DB_AVAILABLE)(
  'MemoryDriftDetectionService (integration)',
  () => {
    let moduleRef: TestingModule | undefined;
    let dataSource: DataSource;
    let repository: Repository<MemorySegment>;
    let detector: MemoryDriftDetectionService;
    let metricsService: MetricsService;
    let eventLedger: InMemoryEventLedger;
    let settings: SystemSettingsStub;

    beforeEach(async () => {
      // The module is rebuilt in `beforeEach` (not `beforeAll`)
      // because the prom-client registry is process-global and
      // holds the `nexusMemoryDriftDetectedTotal` counter. A
      // single module would have its counter accumulate across
      // tests (the test would then assert on stale numbers);
      // rebuilding per test gives each test a fresh
      // `MetricsService` with a freshly-registered counter.
      //
      // Migration cost is bounded: `migrationsRun: true` only
      // runs pending migrations, so the first test pays the
      // baseline cost and subsequent tests see an already-
      // migrated schema.
      register.clear();
      moduleRef = await buildModule();
      dataSource = moduleRef.get(DataSource);
      repository = moduleRef.get<Repository<MemorySegment>>(
        getRepositoryToken(MemorySegment),
      );
      detector = moduleRef.get(MemoryDriftDetectionService);
      metricsService = moduleRef.get(MetricsService);
      eventLedger = (
        moduleRef as TestingModule & { __eventLedger: InMemoryEventLedger }
      ).__eventLedger;
      settings = (
        moduleRef as TestingModule & { __settings: SystemSettingsStub }
      ).__settings;
      await truncateMemorySegments(dataSource);
      for (const spec of SEED) {
        await insertSeed(repository, spec);
      }
      eventLedger.reset();
      settings.get.mockClear();
    });

    afterEach(async () => {
      // Drop the spec-local instruments and close the module
      // so subsequent specs start from a clean slate.
      await moduleRef?.close();
      moduleRef = undefined;
      register.clear();
      vi.clearAllMocks();
    });

    it('seeds 10 segments with the documented source-file-reality mix (sanity check)', async () => {
      const idsInDb = new Set((await repository.find({})).map((row) => row.id));
      expect(idsInDb.size).toBe(10);
      for (const spec of SEED) {
        expect(idsInDb.has(spec.id), `missing seed row ${spec.id}`).toBe(true);
      }
      const driftedSpecs = SEED.filter(
        (row) => row.expectedOutcome === 'drifted',
      );
      const unchangedSpecs = SEED.filter(
        (row) => row.expectedOutcome === 'unchanged',
      );
      expect(driftedSpecs).toHaveLength(3);
      expect(unchangedSpecs).toHaveLength(7);
    });

    it('drifts exactly 3 of 10 seeded segments (30% drift rate) and stamps the per-row penalty', async () => {
      const summary = await detector.runDriftPass({ now: NOW });

      // -------------------------------------------------------------------------
      // Run summary — the canonical "3 / 10 drift" assertion
      // -------------------------------------------------------------------------
      //
      // All 10 segments are non-archived AND have
      // `drift_detected_at IS NULL` going into the pass, so the
      // candidate query returns the full set. The detector
      // visits every candidate and counts it in `checkedCount`
      // regardless of outcome. The 3 expected-to-drift rows
      // (missing file, missing schema column, missing API
      // endpoint) trigger the drift path; the 7 others
      // (2 file-present, 2 schema-present, 1 api-present,
      // 2 exempt) do not. The summary is the wire contract
      // the BullMQ processor and the operator-facing
      // observability dashboards read.

      expect(summary.candidateCount).toBe(10);
      expect(summary.checkedCount).toBe(10);
      expect(summary.driftDetectedCount).toBe(3);
      expect(summary.skipped).toBe(false);
      expect(summary.reason).toBeUndefined();
      expect(summary.errors).toEqual([]);

      // -------------------------------------------------------------------------
      // Per-row DB state — the canonical assertion on the
      // 30 % drift rate
      // -------------------------------------------------------------------------
      //
      // Re-query the repository after the pass and assert on the
      // per-row state. The 3 drifted rows have
      // `drift_detected_at` set to `NOW` and their
      // `metadata_json.confidence` reduced from 0.9 → 0.7 (the
      // hardcoded 0.2 default penalty). The 7 unchanged rows
      // keep their starting confidence and a null
      // `drift_detected_at`.

      const rowsAfter = await repository.find({});
      const byId = new Map(rowsAfter.map((row) => [row.id, row]));

      for (const spec of SEED) {
        const row = byId.get(spec.id);
        expect(row, `row ${spec.id} should still exist`).toBeDefined();
        if (spec.expectedOutcome === 'drifted') {
          // The drift row was stamped + penalised.
          expect(
            row?.drift_detected_at,
            `drifted row ${spec.id} should have drift_detected_at set`,
          ).toEqual(NOW);
          // 0.9 - 0.2 = 0.7 (the hardcoded default penalty).
          // Float-precision guard: 0.9 - 0.2 = 0.7 exactly
          // (no IEEE-754 rounding error in this case), but we
          // use `toBeCloseTo` to stay consistent with the
          // float-precision guards in the unit tests.
          expect(row?.metadata_json?.['confidence']).toBeCloseTo(0.7, 10);
        } else {
          // The unchanged row was NOT touched: no stamp, no
          // penalty, original confidence preserved.
          expect(
            row?.drift_detected_at,
            `unchanged row ${spec.id} should have drift_detected_at still null`,
          ).toBeNull();
          expect(row?.metadata_json?.['confidence']).toBe(0.9);
        }
      }

      // Spot-check one drifted row in isolation so the wire
      // contract is explicit in the test output.
      const driftedFileRow = byId.get('00000000-0000-4000-8000-000000000003');
      expect(driftedFileRow?.drift_detected_at).toEqual(NOW);
      expect(driftedFileRow?.metadata_json?.['confidence']).toBeCloseTo(
        0.7,
        10,
      );

      // Spot-check one exempt row — it points at a missing
      // file path, but the detector short-circuited on the
      // source allowlist BEFORE the file checker ran.
      const exemptRow = byId.get('00000000-0000-4000-8000-000000000009');
      expect(exemptRow?.drift_detected_at).toBeNull();
      expect(exemptRow?.metadata_json?.['confidence']).toBe(0.9);
    });

    it('increments the nexusMemoryDriftDetectedTotal counter with the documented (source, outcome) label pairs', async () => {
      await detector.runDriftPass({ now: NOW });

      // The detector records a metric value for each evaluated
      // row that lands in one of three terminal outcomes:
      //   - `outcome: 'detected'` for drifted rows (3 total)
      //   - `outcome: 'exempt'`   for exempt-source rows (2 total)
      //
      // Rows that did not drift but were evaluated (file
      // present, schema present, API present) do NOT bump the
      // counter — the prom-client counter is a drift-detection
      // signal, not an evaluation counter, per the documented
      // contract on `recordDriftMetric(...)`.

      const value = await metricsService.nexusMemoryDriftDetectedTotal.get();

      const counterEntries = value.values.map((entry) => ({
        source: entry.labels['source'],
        outcome: entry.labels['outcome'],
        value: entry.value,
      }));

      // The drifted rows produced exactly three
      // `(source, detected)` increments — one per reference
      // kind (file, schema, api). Each increment lands at
      // `value = 1` because every kind drifted exactly once.
      const detectedEntries = counterEntries.filter(
        (entry) => entry.outcome === 'detected',
      );
      expect(detectedEntries).toHaveLength(3);

      const detectedLabels = detectedEntries
        .map((entry) => entry.source)
        .sort();
      expect(detectedLabels).toEqual(['api', 'file', 'schema']);
      for (const entry of detectedEntries) {
        expect(entry.value).toBe(1);
      }

      // The exempt-source rows produced exactly two
      // `(unknown, exempt)` increments — the parser was never
      // invoked on the exempt short-circuit, so the
      // `referenceKind` is the sentinel `'unknown'`.
      const exemptEntries = counterEntries.filter(
        (entry) => entry.outcome === 'exempt',
      );
      expect(exemptEntries).toHaveLength(1);
      expect(exemptEntries[0]?.source).toBe('unknown');
      expect(exemptEntries[0]?.value).toBe(2);

      // Sanity: no `unavailable` outcome (no checker failures).
      expect(
        counterEntries.some((entry) => entry.outcome === 'unavailable'),
      ).toBe(false);
    });

    it('emits the memory.segment.drift_detected.v1 event exactly 3 times (one per drifted row)', async () => {
      await detector.runDriftPass({ now: NOW });

      // The detector only emits on `drifted === true`. The 3
      // drifted rows each trigger exactly one
      // `emitBestEffort(...)` call (via
      // `emitDriftEventBestEffort(...)`). The 2 exempt rows
      // do NOT trigger an emission (they return
      // `drifted: false`). The 5 unchanged rows (file /
      // schema / API present) likewise do NOT emit (the
      // detector only emits on drift).
      const driftEvents = eventLedger.events.filter(
        (event) => event.eventName === MEMORY_DRIFT_EVENT_NAME,
      );
      expect(driftEvents).toHaveLength(3);

      // Every emitted event carries the per-row payload: the
      // segmentId, the referenceKind, the original and
      // post-penalty confidence, and the drift stamp. Assert
      // on each so a regression that drops a payload field
      // shows up here.
      const emittedSegmentIds = driftEvents
        .map((event) => (event.payload as { segmentId: string }).segmentId)
        .sort();
      expect(emittedSegmentIds).toEqual([
        '00000000-0000-4000-8000-000000000003', // file, missing
        '00000000-0000-4000-8000-000000000006', // schema, missing
        '00000000-0000-4000-8000-000000000008', // api, missing
      ]);

      // Spot-check one event's payload shape so the wire
      // contract is explicit. The drift stamp is the run's
      // `now`; the confidence pair is the penalty-applied
      // delta (0.9 → 0.7).
      const fileDriftEvent = driftEvents.find(
        (event) =>
          (event.payload as { segmentId: string }).segmentId ===
          '00000000-0000-4000-8000-000000000003',
      );
      expect(fileDriftEvent).toBeDefined();
      expect(fileDriftEvent?.domain).toBe('memory');
      expect(fileDriftEvent?.outcome).toBe('success');
      expect(fileDriftEvent?.payload).toMatchObject({
        segmentId: '00000000-0000-4000-8000-000000000003',
        referenceKind: 'file',
        reference: 'apps/api/src/memory/_does_not_exist_/missing.ts',
        originalConfidence: 0.9,
        newConfidence: 0.7,
        reason: 'file_missing',
        source: 'project.fact',
        driftDetectedAt: NOW.toISOString(),
      });

      // The exempt rows MUST NOT produce a drift event.
      const exemptSegmentIds = new Set([
        '00000000-0000-4000-8000-000000000009',
        '00000000-0000-4000-8000-00000000000a',
      ]);
      for (const event of driftEvents) {
        expect(
          exemptSegmentIds.has(
            (event.payload as { segmentId: string }).segmentId,
          ),
        ).toBe(false);
      }

      // The event ledger is captured exactly 3 times — once
      // per drifted row, no more, no less. (No
      // `memory.*` events other than `drift_detected.v1`
      // are emitted by the detector.)
      expect(eventLedger.events).toHaveLength(3);
    });
  },
);

// ---------------------------------------------------------------------------
// Safety-gate test — always runs, regardless of DB availability.
// Asserts the destructive suite is gated on a DEDICATED throwaway DB,
// never the everyday application DB.
// ---------------------------------------------------------------------------

describe('integration-test safety gate', () => {
  it('does not target the application database by default', () => {
    // The destructive suite must be gated on a DEDICATED throwaway DB,
    // never the everyday DB_HOST/DB_DATABASE the running app uses.
    const gatedOnDedicatedVar = Boolean(
      process.env['INTEGRATION_TEST_DATABASE_URL'],
    );
    const appDbVarsPresent = Boolean(
      process.env['DB_HOST'] ??
      process.env['DB_DATABASE'] ??
      process.env['DATABASE_URL'],
    );
    // If only app DB vars are present (the normal dev/CI case), the
    // destructive suite MUST be skipped.
    if (appDbVarsPresent && !gatedOnDedicatedVar) {
      expect(DB_AVAILABLE).toBe(false);
    }
  });
});
