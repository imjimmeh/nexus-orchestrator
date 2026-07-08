import type { MEMORY_DRIFT_SETTING_KEYS } from './memory-drift.constants';

/**
 * Public type surface for the `MemoryDriftDetectionService`
 * (work item 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * Splitting the types out of `memory-drift.constants.ts` keeps the
 * constants file free of TypeScript type aliases (the project's
 * ESLint configuration enforces this via `no-restricted-syntax`)
 * and lets the scheduler, processor, and follow-up test files
 * (work item continuation) import the contracts without pulling
 * in the constants module's `as const` objects.
 */

/**
 * Union of `SystemSettingsService` keys that the drift detector
 * resolves from operator-tunable settings. The type is exported
 * for compile-time guarantees that callers only use the canonical
 * keys declared in {@link MEMORY_DRIFT_SETTING_KEYS} — an off-by-
 * one typo (`memory_drift_enable` vs `memory_drift_enabled`) would
 * silently fall through to the hardcoded default.
 */
export type MemoryDriftSettingKey =
  (typeof MEMORY_DRIFT_SETTING_KEYS)[keyof typeof MEMORY_DRIFT_SETTING_KEYS];

/**
 * Classification of the references the parser can extract from a
 * segment's `source_metadata`:
 *
 *   - `file` — a relative repo path (e.g. `apps/api/src/foo.ts`).
 *     The detector uses `fs.promises.stat` to verify the file
 *     still exists on disk.
 *   - `schema` — a `table.column` or `table.column.field`
 *     identifier. The detector uses the TypeORM `DataSource`
 *     metadata to verify the column still exists.
 *   - `api` — an HTTP-method-prefixed endpoint string
 *     (e.g. `GET /v1/orders`). The detector uses a regex match
 *     against the local code corpus to verify the route handler
 *     still exists.
 *   - `unknown` — the parser could not classify the metadata. The
 *     detector treats this as "not applicable to drift detection"
 *     and skips the row without modifying it.
 */
export type MemoryDriftReferenceKind = 'file' | 'schema' | 'api' | 'unknown';

/**
 * Result of a single drift-detection pass. The fields are
 * populated incrementally as the detector iterates the candidate
 * set so a caller (and unit test) can assert on a single
 * structured summary without scraping log lines.
 *
 *   - `startedAt` — wall-clock captured at the start of the pass.
 *   - `completedAt` — wall-clock captured at the end of the pass
 *     (success or failure).
 *   - `candidateCount` — the number of rows returned by
 *     `findDriftCandidates(...)` before per-row processing.
 *   - `checkedCount` — the number of rows the detector actually
 *     processed (exempt sources and `no_driftable_reference`
 *     rows are counted here so the "skipped vs evaluated"
 *     accounting stays uniform).
 *   - `driftDetectedCount` — the number of rows for which the
 *     detector stamped `drift_detected_at`, applied the
 *     confidence penalty, and emitted the domain event.
 *   - `skipped` — true when the kill switch (`memory_drift_enabled`)
 *     is off or the candidate set was empty. When `skipped` is
 *     true, the other counters are all zero and the detector did
 *     not touch any row in the database.
 *   - `reason` — the human-readable reason the detector skipped
 *     (e.g. `'disabled'` or `'no_candidates'`). Undefined for
 *     successful passes.
 *   - `errors` — per-row errors encountered during the pass. The
 *     detector continues past these so a transient failure on
 *     one row does not lose the rest of the batch.
 */
export interface MemoryDriftRunSummary {
  startedAt: Date;
  completedAt: Date;
  candidateCount: number;
  checkedCount: number;
  driftDetectedCount: number;
  skipped: boolean;
  reason?: 'disabled' | 'no_candidates';
  errors: Array<{ segmentId: string; message: string }>;
}

/**
 * Per-row outcome of a drift-detection check. Surfaced for log
 * lines and the `memory.segment.drift_detected.v1` event payload.
 * The fields are populated by `MemoryDriftDetectionService.evaluate`
 * and are *always* defined — even rows that are exempt or have no
 * driftable reference produce a fully-populated result so callers
 * never have to discriminate on `undefined`.
 *
 *   - `segmentId` — the row's primary key.
 *   - `drifted` — true when the checker returned `{ drifted: true }`.
 *   - `referenceKind` — the kind the parser classified the
 *     `source_metadata` as.
 *   - `reference` — the canonical reference string the checker
 *     was invoked with (the parser's `reference` output).
 *   - `originalConfidence` — the segment's
 *     `metadata_json.confidence` *before* the detector applied
 *     the penalty. `null` when the row had no confidence value.
 *   - `newConfidence` — the clamped, post-penalty confidence.
 *     Equal to `originalConfidence` when the row was not drifted
 *     (no mutation). `null` when `originalConfidence` is `null`.
 *   - `reason` — the reason string the checker returned
 *     (e.g. `'file_missing'`, `'schema_reference_present'`,
 *     `'no_driftable_reference'`, `'exempt'`).
 *   - `exempt` — true when the row's `source` was in the
 *     {@link MEMORY_DRIFT_EXEMPT_SOURCES} allowlist and the
 *     detector short-circuited without invoking a checker.
 *   - `checkedAt` — wall-clock captured when the per-row check
 *     resolved (used as the row's `drift_detected_at` stamp on
 *     drift detection).
 */
export interface MemoryDriftDetectionResult {
  segmentId: string;
  drifted: boolean;
  referenceKind: MemoryDriftReferenceKind;
  reference: string;
  originalConfidence: number | null;
  newConfidence: number | null;
  reason: string;
  exempt: boolean;
  checkedAt: Date;
}

/**
 * Constructor-time options for the
 * {@link MemoryDriftDetectionService}. All fields are optional;
 * the service falls back to documented defaults when an option is
 * absent. Splitting these out of the constructor signature keeps
 * the service's DI surface narrow (the only *required* injection
 * is the `MemorySegment` repository) and lets tests override the
 * file / schema / code-corpus roots without monkey-patching the
 * service internals.
 */
export interface MemoryDriftDetectionServiceOptions {
  /**
   * Filesystem root used to resolve the file-drift checker's
   * `reference` against. Defaults to `process.cwd()` (the
   * NestJS application root). The file-drift checker rejects
   * references that escape this root (e.g. `../../etc/passwd`)
   * with `{ drifted: true, reason: 'path_outside_repo' }`.
   */
  repoRoot?: string;

  /**
   * Filesystem root for the code-corpus enumeration used by the
   * API-drift checker. Defaults to `<repoRoot>/apps/api/src`.
   * The detector walks the tree once on first use and caches
   * the file list in memory until the process restarts.
   */
  codeCorpusRoot?: string;
}

/**
 * Extracted reference from a `MemorySegment.source_metadata`
 * blob. Returned by the parser to the detector service so the
 * service can dispatch to the matching checker without
 * re-classifying the metadata shape.
 *
 *   - `kind` — the parser's classification of the reference.
 *   - `reference` — the canonical reference string the checker
 *     will receive (already normalised: relative path for
 *     `file`, `table.column` (optionally with `.field` suffix)
 *     for `schema`, raw `METHOD /path` for `api`).
 */
export interface MemoryDriftParsedReference {
  kind: MemoryDriftReferenceKind;
  reference: string;
}

/**
 * Stable identifier for the reason string returned by a checker.
 * Surfaced in the `memory.segment.drift_detected.v1` event
 * payload so downstream consumers can branch on the kind of
 * drift (file missing, schema column missing, API endpoint
 * missing, or a checker-unavailable fallback).
 */
export interface MemoryDriftCheckerResult {
  drifted: boolean;
  reason: string;
}

/**
 * Abstract code corpus used by the API-drift checker. The
 * detector service builds a concrete implementation from
 * `<repoRoot>/apps/api/src/<all-dirs>/<file>.ts|js` (see
 * {@link buildCodeCorpus}) and injects it into
 * {@link checkApiDrift}. The interface is intentionally narrow:
 *
 *   - `read(glob)` — enumeration of files matching the glob.
 *     Returns absolute file paths.
 *   - `search(pattern)` — count of files containing at least one
 *     match for the regex.
 *
 * Splitting the corpus from the checker lets unit tests stub the
 * corpus with an in-memory `{ read: () => Promise.resolve([]),
 * search: () => Promise.resolve(0) }` without spinning up the
 * filesystem.
 */
export interface MemoryDriftCodeCorpus {
  read(glob: string): Promise<string[]>;
  search(pattern: RegExp): Promise<number>;
}
