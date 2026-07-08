/**
 * Unit tests for the `MemoryDriftDetectionService`.
 *
 * Work item: 0cead042-e823-4e26-9386-02042252ffb0.
 *
 * Milestone: "6+ unit tests covering missing-file, schema-changed,
 * API-renamed, exempt sources, kill switch, settings override".
 *
 * This file exercises the detector's contract using Vitest mocks
 * for the repository, settings, event-ledger, metrics, parser, and
 * checker dependencies — no live DB, no BullMQ queue, no real
 * filesystem walk. The construction is direct
 * (`new MemoryDriftDetectionService(...)`) per the documented
 * testability contract on the service — every collaborator is
 * either `@Optional()` or has a constructor-injectable seam, so
 * the NestJS DI container is not needed.
 *
 * Test scenarios (≥6 per the work item acceptance criteria):
 *   1. Missing-file drift (file reference → `file_missing`).
 *   2. Schema-changed drift (`schema` reference → `schema_reference_missing`).
 *   3. API-renamed drift (`api` reference → `api_reference_missing`).
 *   4. Exempt sources (`learning_candidate` /
 *      `workflow_failure_postmortem` are skipped without modification).
 *   5. Kill switch (`memory_drift_enabled = false` short-circuits).
 *   6. Settings override (operator-tuned `memory_drift_confidence_penalty`
 *      is honoured, not the hardcoded default).
 *
 * Plus defensive coverage:
 *   7. File present (no drift): a clean check still counts in
 *      `checkedCount` but does NOT bump the metric (the metric
 *      is a drift-detection signal, not an evaluation counter).
 *   8. Metric counter labels: each `(source, outcome)` pair is
 *      recorded exactly once per row across a 3-drift + 1-exempt
 *      candidate set.
 *   9. Recheck window: the operator-tuned
 *      `memory_drift_recheck_after_ms` is propagated to the
 *      candidate query (the `drift_detected_at < :recheckCutoff`
 *      branch fires, not the "only un-drifted rows" branch).
 *  10. Per-row error: a checker rejection on one row does not
 *      fail the rest of the pass (the failed row's error appears
 *      in `summary.errors[]`, the next candidate is still
 *      evaluated).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, DataSource } from 'typeorm';
import { register } from 'prom-client';
import { MemoryDriftDetectionService } from './memory-drift-detection.service';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type { MetricsService } from '../observability/metrics.service';
import { MemoryDriftReferenceParser } from './memory-drift-reference.parser';
import { MemoryDriftCheckers } from './memory-drift-checkers';
import {
  MEMORY_DRIFT_EVENT_NAME,
  MEMORY_DRIFT_EXEMPT_SOURCES,
  MEMORY_DRIFT_SETTING_KEYS,
} from './memory-drift.constants';

// ---------------------------------------------------------------------------
// Fixed test clock
// ---------------------------------------------------------------------------
//
// The detector reads the wall-clock for the run summary's `startedAt`,
// for the `drift_detected_at` stamp, and for the recheck-window
// cutoff. All three are anchored to this fixed `NOW` so the test
// matrix is fully deterministic (no wall-clock dependency).

const NOW = new Date('2026-06-20T12:00:00.000Z');
const ONE_DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockRepo {
  createQueryBuilder: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

interface MockQueryBuilder {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
}

interface MockSettings {
  get: ReturnType<typeof vi.fn>;
}

interface MockEventLedger {
  emitBestEffort: ReturnType<typeof vi.fn>;
}

interface MockMetrics {
  recordMemoryDriftDetected: ReturnType<typeof vi.fn>;
}

interface MockParser {
  parse: ReturnType<typeof vi.fn>;
}

interface MockCheckers {
  checkFile: ReturnType<typeof vi.fn>;
  checkSchema: ReturnType<typeof vi.fn>;
  checkApi: ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a `MemorySegment` with sensible defaults. The detector
 * only reads `id`, `source`, `metadata_json`, and (via the
 * candidate query) `archived_at` / `drift_detected_at`. The other
 * columns are seeded for type-safety so the returned object is a
 * fully-typed `MemorySegment` without any `as unknown as` cast.
 */
function buildSegment(overrides: Partial<MemorySegment> = {}): MemorySegment {
  return {
    id: 'segment-default',
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
 * Build a chainable TypeORM `QueryBuilder` stub. The detector's
 * private `findDriftCandidates(...)` chains
 * `createQueryBuilder('segment').where(...).andWhere(...).getMany()`,
 * so the stub returns itself from each mutator and resolves
 * `getMany()` with the supplied rows.
 */
function buildQueryBuilder(rows: MemorySegment[]): MockQueryBuilder {
  const qb: MockQueryBuilder = {
    where: vi.fn(),
    andWhere: vi.fn(),
    getMany: vi.fn(),
  };
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.getMany.mockResolvedValue(rows);
  return qb;
}

/**
 * Wire the `SystemSettingsService` mock to return the supplied
 * values for each canonical drift setting key. Mirrors the
 * `configureSettings(...)` helper in the decay / eviction reaper
 * specs.
 */
function configureSettings(
  settings: MockSettings,
  values: {
    enabled?: boolean;
    confidencePenalty?: number;
    recheckAfterMs?: number;
  },
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_DRIFT_SETTING_KEYS.enabled) {
      return Promise.resolve(
        values.enabled !== undefined ? values.enabled : defaultValue,
      );
    }
    if (key === MEMORY_DRIFT_SETTING_KEYS.confidencePenalty) {
      return Promise.resolve(
        values.confidencePenalty !== undefined
          ? values.confidencePenalty
          : defaultValue,
      );
    }
    if (key === MEMORY_DRIFT_SETTING_KEYS.recheckAfterMs) {
      return Promise.resolve(
        values.recheckAfterMs !== undefined
          ? values.recheckAfterMs
          : defaultValue,
      );
    }
    return Promise.resolve(defaultValue);
  }) as never);
}

/**
 * Build a minimal `DataSource` mock. The detector's
 * `buildSchemaIndex(...)` only reads `entityMetadatas`, so the
 * mock is a plain object literal with that one field.
 */
function buildDataSource(
  entities: Array<{
    tableName: string;
    columns: Array<{ propertyName: string }>;
  }> = [],
): Pick<DataSource, 'entityMetadatas'> {
  return {
    entityMetadatas: entities.map((entity) => ({
      tableName: entity.tableName,
      columns: entity.columns,
    })) as unknown as DataSource['entityMetadatas'],
  };
}

/**
 * Construct the detector with mocks wired in. Centralised so each
 * test can pick which collaborators to override (e.g. real
 * parser vs. stub parser) without repeating the 9-argument
 * constructor call.
 */
function buildDetector(args: {
  repo: MockRepo;
  settings: MockSettings;
  metrics: MockMetrics;
  eventLedger?: MockEventLedger;
  dataSource?: Pick<DataSource, 'entityMetadatas'>;
  parser?: MockParser;
  checkers?: MockCheckers;
  options?: { repoRoot?: string; codeCorpusRoot?: string };
}): MemoryDriftDetectionService {
  return new MemoryDriftDetectionService(
    args.repo as unknown as Repository<MemorySegment>,
    (args.dataSource ?? buildDataSource()) as unknown as DataSource,
    args.settings as unknown as SystemSettingsService,
    args.metrics as unknown as MetricsService,
    (args.eventLedger ?? {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    }) as unknown as EventLedgerService,
    // Default to the real `MemoryDriftReferenceParser` so the
    // detector runs the documented parser rules against the
    // test's `metadata_json` blob. Tests that want to assert on
    // the parser contract (e.g. the exempt test, which expects
    // the parser to NOT be called) supply a stub via
    // `args.parser`.
    (args.parser ??
      new MemoryDriftReferenceParser()) as unknown as ConstructorParameters<
      typeof MemoryDriftDetectionService
    >[5],
    (args.checkers ??
      new MemoryDriftCheckers()) as unknown as ConstructorParameters<
      typeof MemoryDriftDetectionService
    >[6],
    undefined,
    args.options,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDriftDetectionService', () => {
  let repo: MockRepo;
  let settings: MockSettings;
  let metrics: MockMetrics;
  let eventLedger: MockEventLedger;

  beforeEach(() => {
    // The prom-client registry is process-global; clear it
    // before each test so the `nexus_memory_drift_detected_total`
    // counter (a registry-singleton) does not bleed across tests.
    // The metrics service spec follows the same pattern.
    register.clear();

    repo = {
      createQueryBuilder: vi.fn(),
      save: vi
        .fn()
        .mockImplementation((segment: MemorySegment) =>
          Promise.resolve(segment),
        ),
    };
    settings = {
      get: vi.fn(),
    };
    metrics = {
      recordMemoryDriftDetected: vi.fn(),
    };
    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    register.clear();
  });

  describe('runDriftPass', () => {
    it('flags a missing-file drift, applies the confidence penalty, and emits the domain event', async () => {
      // Case 1: missing-file drift. The candidate row's
      // `metadata_json.filePath` points at a path that does not
      // exist. The detector parses the metadata via the real
      // parser, dispatches to the (mocked) file checker, applies
      // the 0.2 default confidence penalty, stamps
      // `drift_detected_at = NOW`, saves the row, and emits
      // `memory.segment.drift_detected.v1` with the per-row
      // payload.
      const missing = buildSegment({
        id: 'seg-missing-file',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/this/path/does/not/exist.ts',
          confidence: 0.5,
        },
      });
      const qb = buildQueryBuilder([missing]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      const checkers: MockCheckers = {
        checkFile: vi.fn().mockResolvedValue({
          drifted: true,
          reason: 'file_missing',
        }),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 1 candidate, 1 checked, 1 drift detected.
      expect(summary.driftDetectedCount).toBe(1);
      expect(summary.checkedCount).toBe(1);
      expect(summary.candidateCount).toBe(1);
      expect(summary.skipped).toBe(false);
      expect(summary.reason).toBeUndefined();
      expect(summary.errors).toEqual([]);

      // The file checker was invoked with the parsed reference
      // (the `apps/api/src/...` path from the metadata).
      expect(checkers.checkFile).toHaveBeenCalledTimes(1);
      expect(checkers.checkFile).toHaveBeenCalledWith(
        'apps/api/src/this/path/does/not/exist.ts',
        expect.any(String),
      );
      // The other checkers were NOT called (the parser classified
      // the row as `file`, not `schema` or `api`).
      expect(checkers.checkSchema).not.toHaveBeenCalled();
      expect(checkers.checkApi).not.toHaveBeenCalled();

      // The row was saved with the confidence penalty applied
      // (0.5 - 0.2 = 0.3) and `drift_detected_at` stamped to NOW.
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.id).toBe('seg-missing-file');
      expect(persisted.drift_detected_at).toEqual(NOW);
      expect(persisted.metadata_json?.['confidence']).toBe(0.3);

      // The `memory.segment.drift_detected.v1` event was emitted
      // with the per-row payload (segmentId, referenceKind,
      // reference, reason, originalConfidence, newConfidence).
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      const eventCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
        domain: string;
        eventName: string;
        outcome: string;
        payload: Record<string, unknown>;
      };
      expect(eventCall.eventName).toBe(MEMORY_DRIFT_EVENT_NAME);
      expect(eventCall.eventName).toBe('memory.segment.drift_detected.v1');
      expect(eventCall.domain).toBe('memory');
      expect(eventCall.outcome).toBe('success');
      expect(eventCall.payload).toMatchObject({
        segmentId: 'seg-missing-file',
        referenceKind: 'file',
        reference: 'apps/api/src/this/path/does/not/exist.ts',
        originalConfidence: 0.5,
        newConfidence: 0.3,
        reason: 'file_missing',
        source: 'project.fact',
        driftDetectedAt: NOW.toISOString(),
      });

      // The `nexus_memory_drift_detected_total{source,outcome}`
      // counter was bumped with `(file, detected)`.
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(1);
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledWith({
        source: 'file',
        outcome: 'detected',
      });
    });

    it('flags a schema-reference drift when the column is missing from the live index', async () => {
      // Case 2: schema-changed drift. The metadata points at a
      // `table.column` reference that the live schema index does
      // not contain (e.g. the column was renamed). The detector
      // parses the metadata via the real parser, builds the
      // schema index from the (mocked) `DataSource` metadata,
      // dispatches to the (mocked) schema checker, applies the
      // 0.2 default confidence penalty, and records the metric
      // under `(schema, detected)`.
      const driftedSchema = buildSegment({
        id: 'seg-schema-drift',
        source: 'project.fact',
        metadata_json: {
          schemaRef: 'llm_models.token_limit',
          confidence: 0.8,
        },
      });
      const qb = buildQueryBuilder([driftedSchema]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      // The mocked `DataSource` exposes an entity for the
      // `llm_models` table but only the `id` column — the
      // `token_limit` column was renamed away in a recent
      // migration, which is what the candidate's metadata still
      // references.
      const dataSource = buildDataSource([
        {
          tableName: 'llm_models',
          columns: [{ propertyName: 'id' }],
        },
      ]);
      const checkers: MockCheckers = {
        checkFile: vi.fn(),
        checkSchema: vi.fn().mockReturnValue({
          drifted: true,
          reason: 'schema_reference_missing',
        }),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        dataSource,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 1 candidate, 1 checked, 1 drift detected.
      expect(summary.driftDetectedCount).toBe(1);
      expect(summary.checkedCount).toBe(1);

      // The schema checker was invoked with the parsed
      // `table.column` reference. The exact index value is
      // opaque to the test (it's a private cache), so we assert
      // on the reference string and that a `Map` was passed.
      expect(checkers.checkSchema).toHaveBeenCalledTimes(1);
      const schemaCallArgs = checkers.checkSchema.mock.calls[0] as unknown as [
        string,
        ReadonlyMap<string, ReadonlySet<string>>,
      ];
      expect(schemaCallArgs[0]).toBe('llm_models.token_limit');
      expect(schemaCallArgs[1]).toBeInstanceOf(Map);
      // The file / api checkers were NOT called.
      expect(checkers.checkFile).not.toHaveBeenCalled();
      expect(checkers.checkApi).not.toHaveBeenCalled();

      // The row was saved with the penalty applied (0.8 - 0.2 = 0.6).
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.drift_detected_at).toEqual(NOW);
      // `toBeCloseTo` because 0.8 - 0.2 = 0.6000000000000001 in
      // IEEE-754 arithmetic; the detector writes the raw float
      // (the `clampConfidence` helper does not round).
      expect(persisted.metadata_json?.['confidence']).toBeCloseTo(0.6, 10);

      // The event was emitted with `referenceKind: 'schema'`.
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      const eventCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
        payload: Record<string, unknown>;
      };
      expect(eventCall.payload).toMatchObject({
        segmentId: 'seg-schema-drift',
        referenceKind: 'schema',
        reference: 'llm_models.token_limit',
        originalConfidence: 0.8,
        reason: 'schema_reference_missing',
      });
      // Float-precision guard: 0.8 - 0.2 = 0.6000000000000001 in
      // IEEE-754 arithmetic; `toMatchObject` uses `Object.is`
      // equality, so the float field is checked separately.
      expect(eventCall.payload['newConfidence']).toBeCloseTo(0.6, 10);

      // The counter was bumped with `(schema, detected)`.
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(1);
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledWith({
        source: 'schema',
        outcome: 'detected',
      });
    });

    it('flags an api-endpoint drift when the route is missing from the code corpus', async () => {
      // Case 3: api-renamed drift. The metadata points at an
      // HTTP-method-prefixed endpoint that the code corpus no
      // longer declares (e.g. the route was renamed). The
      // detector parses the metadata via the real parser, builds
      // the code corpus (the corpus root is set to a non-existent
      // path so the filesystem walk is a no-op), dispatches to
      // the (mocked) api checker, applies the penalty, and
      // records the metric under `(api, detected)`.
      const driftedApi = buildSegment({
        id: 'seg-api-drift',
        source: 'project.fact',
        metadata_json: {
          apiEndpoint: 'GET /v1/workflows/{id}/archive',
          confidence: 0.7,
        },
      });
      const qb = buildQueryBuilder([driftedApi]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      const checkers: MockCheckers = {
        checkFile: vi.fn(),
        checkSchema: vi.fn(),
        checkApi: vi.fn().mockResolvedValue({
          drifted: true,
          reason: 'api_reference_missing',
        }),
      };
      // Use a non-existent codeCorpusRoot so the lazy
      // `buildCodeCorpus(...)` call inside the service is a fast
      // no-op (`walkSourceTree` swallows the ENOENT and returns
      // an empty file list). The mocked api checker does not
      // actually scan the corpus — it just returns the
      // deterministic "missing" outcome — so the corpus value
      // itself is opaque to the test.
      const nonExistentRoot = '/tmp/__nexus_drift_test_no_such_dir__';
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
        options: { codeCorpusRoot: nonExistentRoot },
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 1 candidate, 1 checked, 1 drift detected.
      expect(summary.driftDetectedCount).toBe(1);
      expect(summary.checkedCount).toBe(1);

      // The api checker was invoked with the parsed endpoint
      // reference. The exact corpus value is opaque to the test,
      // so we assert on the reference string and that a corpus
      // object (with `search` / `read`) was passed.
      expect(checkers.checkApi).toHaveBeenCalledTimes(1);
      const apiCallArgs = checkers.checkApi.mock.calls[0] as unknown as [
        string,
        { search: unknown; read: unknown },
      ];
      expect(apiCallArgs[0]).toBe('GET /v1/workflows/{id}/archive');
      expect(typeof apiCallArgs[1].search).toBe('function');
      expect(typeof apiCallArgs[1].read).toBe('function');
      // The file / schema checkers were NOT called.
      expect(checkers.checkFile).not.toHaveBeenCalled();
      expect(checkers.checkSchema).not.toHaveBeenCalled();

      // The row was saved with the penalty applied (0.7 - 0.2 = 0.5).
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.drift_detected_at).toEqual(NOW);
      // `toBeCloseTo` because 0.7 - 0.2 = 0.49999999999999994 in
      // IEEE-754 arithmetic; the detector writes the raw float.
      expect(persisted.metadata_json?.['confidence']).toBeCloseTo(0.5, 10);

      // The event was emitted with `referenceKind: 'api'`.
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      const eventCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
        payload: Record<string, unknown>;
      };
      expect(eventCall.payload).toMatchObject({
        segmentId: 'seg-api-drift',
        referenceKind: 'api',
        reference: 'GET /v1/workflows/{id}/archive',
        originalConfidence: 0.7,
        reason: 'api_reference_missing',
      });
      // Float-precision guard: 0.7 - 0.2 = 0.49999999999999994 in
      // IEEE-754 arithmetic; `toMatchObject` uses `Object.is`
      // equality, so the float field is checked separately.
      expect(eventCall.payload['newConfidence']).toBeCloseTo(0.5, 10);

      // The counter was bumped with `(api, detected)`.
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(1);
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledWith({
        source: 'api',
        outcome: 'detected',
      });
    });

    it('skips exempt sources without invoking the parser, checkers, or DB writes', async () => {
      // Case 4: exempt sources. The two candidate rows carry
      // sources from the `MEMORY_DRIFT_EXEMPT_SOURCES` allowlist
      // (`learning_candidate` and `workflow_failure_postmortem`).
      // The detector short-circuits BEFORE the parser / checkers
      // run, so:
      //   - the parser is NOT called,
      //   - the checkers are NOT called,
      //   - the row is NOT saved (no `drift_detected_at` stamp,
      //     no confidence penalty),
      //   - the event ledger is NOT called (the detector only
      //     emits on `drifted === true`),
      //   - the metric is recorded with `outcome: 'exempt'`
      //     (the documented "row was inspected but skipped"
      //     signal), and
      //   - `summary.checkedCount` is still 2 (the exempt branch
      //     counts as "checked") but `driftDetectedCount` is 0.
      const learningCandidate = buildSegment({
        id: 'seg-learning-candidate',
        source: 'learning_candidate',
        metadata_json: {
          filePath: 'apps/api/src/some/missing/file.ts',
          confidence: 0.5,
        },
      });
      const failurePostmortem = buildSegment({
        id: 'seg-failure-postmortem',
        source: 'workflow_failure_postmortem',
        metadata_json: {
          filePath: 'apps/api/src/another/missing/file.ts',
          confidence: 0.5,
        },
      });
      const qb = buildQueryBuilder([learningCandidate, failurePostmortem]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      // The parser mock is wired to a sentinel so any accidental
      // call would be observable in the test failure.
      const parser: MockParser = {
        parse: vi.fn(() => {
          throw new Error('parser must not be called for exempt sources');
        }),
      };
      const checkers: MockCheckers = {
        checkFile: vi.fn(() => {
          throw new Error('checkFile must not be called for exempt sources');
        }),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        parser,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 2 candidates, 2 checked, 0 drift detected.
      expect(summary.candidateCount).toBe(2);
      expect(summary.checkedCount).toBe(2);
      expect(summary.driftDetectedCount).toBe(0);
      expect(summary.skipped).toBe(false);
      expect(summary.errors).toEqual([]);

      // The parser and the file checker were NOT called.
      expect(parser.parse).not.toHaveBeenCalled();
      expect(checkers.checkFile).not.toHaveBeenCalled();
      expect(checkers.checkSchema).not.toHaveBeenCalled();
      expect(checkers.checkApi).not.toHaveBeenCalled();

      // No DB writes — the row's `drift_detected_at` stays null
      // and `metadata_json.confidence` is untouched.
      expect(repo.save).not.toHaveBeenCalled();

      // The event ledger is NOT called — the detector only
      // emits on `drifted === true`, and the exempt branch
      // returns `drifted: false`.
      expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();

      // The metric counter is bumped once per row with
      // `outcome: 'exempt'`. The `source` label is the parser's
      // `referenceKind`, which is `'unknown'` for the exempt
      // short-circuit (the parser was never invoked).
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(2);
      expect(metrics.recordMemoryDriftDetected).toHaveBeenNthCalledWith(1, {
        source: 'unknown',
        outcome: 'exempt',
      });
      expect(metrics.recordMemoryDriftDetected).toHaveBeenNthCalledWith(2, {
        source: 'unknown',
        outcome: 'exempt',
      });

      // Sanity check: the `MEMORY_DRIFT_EXEMPT_SOURCES` allowlist
      // actually contains the two sources the test exercises.
      // A future edit that drops one of them would otherwise
      // change the contract the detector relies on.
      expect(MEMORY_DRIFT_EXEMPT_SOURCES).toEqual(
        expect.arrayContaining([
          'learning_candidate',
          'workflow_failure_postmortem',
        ]),
      );
    });

    it('short-circuits to a skipped summary when memory_drift_enabled is false (kill switch)', async () => {
      // Case 5: kill switch. The detector reads
      // `memory_drift_enabled` first and short-circuits with
      // `{ skipped: true, reason: 'disabled', ... }` BEFORE
      // touching the candidate query. The repository's
      // `createQueryBuilder(...)` is NEVER called, no row is
      // saved, the event ledger is not invoked, and the
      // prom-client counter is NOT incremented.
      settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
        if (key === MEMORY_DRIFT_SETTING_KEYS.enabled) {
          return Promise.resolve(false);
        }
        return Promise.resolve(defaultValue);
      }) as never);

      const checkers: MockCheckers = {
        checkFile: vi.fn(),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // The summary reports the disabled short-circuit.
      expect(summary.skipped).toBe(true);
      expect(summary.reason).toBe('disabled');
      expect(summary.candidateCount).toBe(0);
      expect(summary.checkedCount).toBe(0);
      expect(summary.driftDetectedCount).toBe(0);
      expect(summary.errors).toEqual([]);

      // No candidate scan — the kill switch is read before the
      // query, so a disabled detector never wakes the DB.
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();

      // No DB writes and no event emission.
      expect(repo.save).not.toHaveBeenCalled();
      expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();

      // The prom-client counter is NOT incremented on a disabled
      // pass: a disabled detector did not evaluate any rows, so
      // the gauge would otherwise carry phantom activity.
      expect(metrics.recordMemoryDriftDetected).not.toHaveBeenCalled();

      // The checkers are not invoked either (no candidates).
      expect(checkers.checkFile).not.toHaveBeenCalled();
      expect(checkers.checkSchema).not.toHaveBeenCalled();
      expect(checkers.checkApi).not.toHaveBeenCalled();
    });

    it('honours an operator-tuned confidence_penalty override via SystemSettingsService', async () => {
      // Case 6: settings override. The operator tightens the
      // confidence penalty from the 0.2 hardcoded default to 0.5.
      // The seed segment starts at 0.9 confidence and would
      // drift to 0.7 under the default — but with the override
      // it lands at 0.4. The test pins the override is actually
      // read, not the default, by asserting the 0.4 value
      // explicitly.
      const drifted = buildSegment({
        id: 'seg-penalty-override',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/this/path/does/not/exist.ts',
          confidence: 0.9,
        },
      });
      const qb = buildQueryBuilder([drifted]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, { confidencePenalty: 0.5 });

      const checkers: MockCheckers = {
        checkFile: vi.fn().mockResolvedValue({
          drifted: true,
          reason: 'file_missing',
        }),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 1 candidate, 1 checked, 1 drift detected.
      expect(summary.driftDetectedCount).toBe(1);

      // The settings service was consulted with the canonical
      // confidence-penalty key. The override (0.5) was supplied
      // — the detector must have read the value, not the 0.2
      // hardcoded default.
      const penaltyCalls = settings.get.mock.calls.filter(
        (call) => call[0] === MEMORY_DRIFT_SETTING_KEYS.confidencePenalty,
      );
      expect(penaltyCalls.length).toBeGreaterThan(0);

      // The row was saved with the override penalty applied
      // (0.9 - 0.5 = 0.4), NOT the default (0.9 - 0.2 = 0.7).
      // Asserting on 0.4 (not 0.7) pins the override contract.
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.metadata_json?.['confidence']).toBe(0.4);
      // Negative assertion: the default would have produced 0.7.
      // (Reading this assertion as a one-line guard against a
      // future edit that drops the override plumbing.)
      expect(persisted.metadata_json?.['confidence']).not.toBe(0.7);

      // The event payload carries the override-derived
      // `newConfidence`, not the default.
      const eventCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
        payload: Record<string, unknown>;
      };
      expect(eventCall.payload['originalConfidence']).toBeCloseTo(0.9, 10);
      // 0.9 - 0.5 = 0.4 (the override penalty); float-precision
      // guard for the same reason as the other tests.
      expect(eventCall.payload['newConfidence']).toBeCloseTo(0.4, 10);
    });

    it('does not bump the metric for a file reference that is present (no drift)', async () => {
      // Defensive: a row whose file reference is present is
      // "checked but not drifted". The detector still counts
      // the row in `checkedCount` (the parser + checker
      // pipeline ran) but does NOT record a metric value — the
      // prom-client counter is a drift-detection signal, not
      // an evaluation counter, per the documented contract on
      // `recordDriftMetric(...)`.
      const present = buildSegment({
        id: 'seg-file-present',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/some/present/file.ts',
          confidence: 0.6,
        },
      });
      const qb = buildQueryBuilder([present]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      const checkers: MockCheckers = {
        checkFile: vi.fn().mockResolvedValue({
          drifted: false,
          reason: 'file_present',
        }),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // The row was checked but did not drift.
      expect(summary.candidateCount).toBe(1);
      expect(summary.checkedCount).toBe(1);
      expect(summary.driftDetectedCount).toBe(0);

      // The file checker WAS called (the row was evaluated).
      expect(checkers.checkFile).toHaveBeenCalledTimes(1);

      // The row was NOT saved (no penalty, no `drift_detected_at`).
      expect(repo.save).not.toHaveBeenCalled();

      // The event ledger was NOT called (events are emitted only
      // on `drifted === true`).
      expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();

      // The prom-client counter is NOT bumped for a "present"
      // outcome — the metric is a drift-detection signal, not
      // an evaluation counter. This pins the documented contract
      // on `recordDriftMetric(...)` (only `drifted === true`,
      // `exempt === true`, or `reason === 'checker_unavailable'`
      // bumps the counter).
      expect(metrics.recordMemoryDriftDetected).not.toHaveBeenCalled();
    });

    it('records the metric with the correct (source, outcome) label pairs across a 3-drift + 1-exempt candidate set', async () => {
      // Defensive: 3 drift scenarios (file, schema, api) plus
      // 1 exempt segment. The metric counter is called 4 times
      // with the correct label pairs — `outcome: 'detected'`
      // for the drifted rows, `outcome: 'exempt'` for the
      // exempt row. No duplicate / extra calls.
      const fileDrift = buildSegment({
        id: 'seg-m-file',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/this/path/does/not/exist.ts',
          confidence: 0.5,
        },
      });
      const schemaDrift = buildSegment({
        id: 'seg-m-schema',
        source: 'project.fact',
        metadata_json: {
          schemaRef: 'llm_models.token_limit',
          confidence: 0.5,
        },
      });
      const apiDrift = buildSegment({
        id: 'seg-m-api',
        source: 'project.fact',
        metadata_json: {
          apiEndpoint: 'GET /v1/workflows/{id}/archive',
          confidence: 0.5,
        },
      });
      const exempt = buildSegment({
        id: 'seg-m-exempt',
        source: 'learning_candidate',
        metadata_json: { confidence: 0.5 },
      });
      const qb = buildQueryBuilder([fileDrift, schemaDrift, apiDrift, exempt]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      const dataSource = buildDataSource([
        { tableName: 'llm_models', columns: [{ propertyName: 'id' }] },
      ]);
      const checkers: MockCheckers = {
        checkFile: vi.fn().mockResolvedValue({
          drifted: true,
          reason: 'file_missing',
        }),
        checkSchema: vi.fn().mockReturnValue({
          drifted: true,
          reason: 'schema_reference_missing',
        }),
        checkApi: vi.fn().mockResolvedValue({
          drifted: true,
          reason: 'api_reference_missing',
        }),
      };
      const nonExistentRoot = '/tmp/__nexus_drift_test_no_such_dir__';
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        dataSource,
        checkers,
        options: { codeCorpusRoot: nonExistentRoot },
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // 4 candidates, 4 checked, 3 drift detected (the exempt
      // row was checked but did not drift).
      expect(summary.candidateCount).toBe(4);
      expect(summary.checkedCount).toBe(4);
      expect(summary.driftDetectedCount).toBe(3);

      // 4 metric calls — 3 × `(file|schema|api, detected)` plus
      // 1 × `(unknown, exempt)`.
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(4);
      const calls = metrics.recordMemoryDriftDetected.mock.calls as Array<
        [{ source: string; outcome: string }]
      >;
      const labels = calls.map((c) => `${c[0].source}/${c[0].outcome}`).sort();
      expect(labels).toEqual([
        'api/detected',
        'file/detected',
        'schema/detected',
        'unknown/exempt',
      ]);

      // Per-row sanity: the 3 events were emitted in the order
      // the candidates were visited, and the exempt row did
      // NOT trigger an event.
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(3);
      const eventSegmentIds = eventLedger.emitBestEffort.mock.calls.map(
        (call) =>
          (call[0] as { payload: { segmentId: string } }).payload.segmentId,
      );
      expect(eventSegmentIds).toEqual([
        'seg-m-file',
        'seg-m-schema',
        'seg-m-api',
      ]);
    });

    it('honours an operator-tuned recheck_after_ms via the candidate query cutoff', async () => {
      // Defensive: the operator tightens the recheck window to
      // one day (86_400_000 ms). The candidate query's
      // `andWhere(...)` clause must reflect the new cutoff —
      // specifically, it must include the recheck predicate
      // `(segment.drift_detected_at IS NULL OR segment.drift_detected_at < :recheckCutoff)`,
      // not the default `segment.drift_detected_at IS NULL` clause.
      // The cutoff value is `now - 86_400_000` in ISO format.
      const qb = buildQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, { recheckAfterMs: ONE_DAY_MS });

      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // No candidates → no drift detected, but the candidate
      // query was still issued (the kill switch is off).
      expect(summary.driftDetectedCount).toBe(0);
      expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);

      // The query builder received the `archived_at IS NULL`
      // baseline clause (always-on).
      expect(qb.where).toHaveBeenCalledTimes(1);
      expect(qb.where).toHaveBeenCalledWith('segment.archived_at IS NULL');

      // The recheck predicate was used (not the default
      // `drift_detected_at IS NULL` clause).
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
      const andWhereArgs = qb.andWhere.mock.calls[0] as unknown as [
        string,
        { recheckCutoff: string },
      ];
      expect(andWhereArgs[0]).toBe(
        '(segment.drift_detected_at IS NULL OR segment.drift_detected_at < :recheckCutoff)',
      );
      // The cutoff is `now - 86_400_000` ms in ISO format.
      const expectedCutoff = new Date(NOW.getTime() - ONE_DAY_MS).toISOString();
      expect(andWhereArgs[1]?.recheckCutoff).toBe(expectedCutoff);
    });

    it('continues past a per-row checker error and records the failure in summary.errors', async () => {
      // Defensive: a transient checker failure on one row
      // (e.g. the file checker rejects with a permission
      // error) must not stop the rest of the pass. The detector
      // catches the per-row error, increments `summary.errors`,
      // and moves on to the next candidate. The next candidate
      // is still evaluated and (in this scenario) drifts as
      // expected.
      const failing = buildSegment({
        id: 'seg-checker-error',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/this/path/does/not/exist.ts',
          confidence: 0.5,
        },
      });
      const ok = buildSegment({
        id: 'seg-checker-ok',
        source: 'project.fact',
        metadata_json: {
          filePath: 'apps/api/src/this/path/also/does/not/exist.ts',
          confidence: 0.5,
        },
      });
      const qb = buildQueryBuilder([failing, ok]);
      repo.createQueryBuilder.mockReturnValue(qb);
      configureSettings(settings, {});

      // The file checker rejects on the first call (failing
      // row) and returns a drift on the second (OK row).
      const checkers: MockCheckers = {
        checkFile: vi
          .fn()
          .mockRejectedValueOnce(new Error('permission denied'))
          .mockResolvedValueOnce({
            drifted: true,
            reason: 'file_missing',
          }),
        checkSchema: vi.fn(),
        checkApi: vi.fn(),
      };
      const detector = buildDetector({
        repo,
        settings,
        metrics,
        eventLedger,
        checkers,
      });

      const summary = await detector.runDriftPass({ now: NOW });

      // Both candidates were visited. The detector's main loop
      // increments `checkedCount` only AFTER `evaluateCandidate`
      // resolves — a thrown error short-circuits the per-row
      // counter, so the failed row is NOT counted in
      // `checkedCount` (it IS counted in `candidateCount` and
      // surfaced in `errors[]`).
      expect(summary.candidateCount).toBe(2);
      expect(summary.checkedCount).toBe(1);
      expect(summary.driftDetectedCount).toBe(1);

      // The failed row's error is surfaced in `summary.errors`.
      // The other row is not in `errors[]`.
      expect(summary.errors).toHaveLength(1);
      const errorEntry = summary.errors[0];
      expect(errorEntry.segmentId).toBe('seg-checker-error');
      expect(errorEntry.message).toBe('permission denied');

      // The file checker was called for both rows (the detector
      // did not short-circuit on the first error).
      expect(checkers.checkFile).toHaveBeenCalledTimes(2);

      // Only the OK row was saved — the failed row's
      // `drift_detected_at` is left untouched.
      expect(repo.save).toHaveBeenCalledTimes(1);
      const persisted = repo.save.mock.calls[0]?.[0] as MemorySegment;
      expect(persisted.id).toBe('seg-checker-ok');

      // The event ledger was called once (for the OK row only).
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      const eventCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
        payload: { segmentId: string };
      };
      expect(eventCall.payload.segmentId).toBe('seg-checker-ok');

      // The metric was called once — the failed row does not
      // record a metric (the error was caught before
      // `recordDriftMetric(...)` ran — only successful
      // per-row evaluations reach the metric path). The OK row
      // records `(file, detected)`.
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledTimes(1);
      expect(metrics.recordMemoryDriftDetected).toHaveBeenCalledWith({
        source: 'file',
        outcome: 'detected',
      });
    });
  });
});
