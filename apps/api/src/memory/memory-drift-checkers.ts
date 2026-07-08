import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  MemoryDriftCheckerResult,
  MemoryDriftCodeCorpus,
} from './memory-drift.types';

/**
 * Drift-detection checkers for the `MemoryDriftDetectionService`
 * (work item 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The checkers are the "reality" half of the drift-detection pass:
 * each one takes a canonical reference string and an abstract
 * index / corpus and returns `{ drifted, reason }`. The detector
 * service is responsible for picking the right checker based on
 * the parser's `kind` output and for translating the result into
 * the row update + event emit + confidence-penalty math.
 *
 * Three checkers are provided, one per documented reference kind:
 *
 *   - `checkFileDrift`   — `fs.promises.stat` against a relative
 *     repo path; rejects path-traversal attempts.
 *   - `checkSchemaDrift` — direct lookup in a precomputed
 *     `Map<string, Set<string>>` keyed by `tableName.columnName`.
 *   - `checkApiDrift`    — regex match against an in-memory code
 *     corpus the detector builds from
 *     `<repoRoot>/apps/api/src/<all-dirs>/<file>.ts|js`.
 *
 * Each checker is a pure / async function. The
 * `MemoryDriftCheckers` NestJS-injectable wrapper at the bottom of
 * the file delegates to the pure functions so the service can
 * `@Inject(MemoryDriftCheckers)` for test substitution. Splitting
 * the pure functions from the wrapper mirrors the
 * `parseMemoryDriftReference` / `MemoryDriftReferenceParser`
 * pattern.
 */

export type { MemoryDriftCheckerResult, MemoryDriftCodeCorpus };

/**
 * File-existence checker for `kind === 'file'` references.
 *
 * Behaviour:
 *   - The reference is resolved against `repoRoot` with
 *     `path.resolve` to canonicalise any embedded `..` segments
 *     before the traversal check.
 *   - A reference whose resolved path escapes `repoRoot` is
 *     reported as `{ drifted: true, reason: 'path_outside_repo' }`
 *     rather than `file_missing` — the operator-facing distinction
 *     matters because a `path_outside_repo` reference is a
 *     security-shaped failure (someone tried to point a segment
 *     at a file outside the repo) and should not look identical
 *     to a routine "the file got renamed" drift event in the
 *     observability feed.
 *   - `fs.promises.stat` rejects with `ENOENT` (and related
 *     codes) when the file is absent. The function catches the
 *     reject and converts it to `{ drifted: true, reason:
 *     'file_missing' }` — any other error (permission denied,
 *     EIO) is re-thrown so the detector service can record it
 *     in the per-row `errors[]` list.
 *   - On success, `{ drifted: false, reason: 'file_present' }`.
 */
export async function checkFileDrift(
  reference: string,
  repoRoot: string,
): Promise<MemoryDriftCheckerResult> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedReference = path.resolve(resolvedRepoRoot, reference);

  if (
    resolvedReference !== resolvedRepoRoot &&
    !resolvedReference.startsWith(`${resolvedRepoRoot}${path.sep}`)
  ) {
    return { drifted: true, reason: 'path_outside_repo' };
  }

  try {
    await fs.stat(resolvedReference);
    return { drifted: false, reason: 'file_present' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { drifted: true, reason: 'file_missing' };
    }
    throw error;
  }
}

/**
 * Schema-reference checker for `kind === 'schema'` references.
 *
 * The schema index is a `Map<string, Set<string>>` keyed by
 * `tableName`; each value is the set of `columnName`s the table
 * exposes in the live database. The detector service is expected
 * to build the index once per pass from the TypeORM `DataSource`
 * metadata (see `MemoryDriftDetectionService.buildSchemaIndex`)
 * and pass it to the checker on each invocation.
 *
 * Behaviour:
 *   - The reference is split on `.` and only the first two
 *     segments (`table.column`) are consulted. A three-segment
 *     reference (`table.column.field`) is still treated as a
 *     `table.column` lookup — the `.field` suffix is a
 *     structured-payload hint that is preserved in the event
 *     payload but does not change the schema-existence check.
 *   - A `table` not present in the index → `schema_reference_missing`.
 *   - A `column` not present in the table's set →
 *     `schema_reference_missing`.
 *   - Otherwise → `schema_reference_present`.
 *
 * An empty index (the "no-index" fallback when the
 * `DataSource` metadata could not be loaded) is handled by the
 * *caller*: the detector service catches index-build failures
 * and substitutes an empty map, which causes the checker to
 * always return `schema_reference_missing` for every schema
 * reference. The checker itself never throws on missing keys;
 * it returns the `missing` reason so a single bad row does not
 * fail the pass.
 */
export function checkSchemaDrift(
  reference: string,
  schemaIndex: ReadonlyMap<string, ReadonlySet<string>>,
): MemoryDriftCheckerResult {
  const segments = reference.split('.');
  if (segments.length < 2) {
    return { drifted: true, reason: 'schema_reference_missing' };
  }

  const table = segments[0] ?? '';
  const column = segments[1] ?? '';
  if (table.length === 0 || column.length === 0) {
    return { drifted: true, reason: 'schema_reference_missing' };
  }

  const columnSet = schemaIndex.get(table);
  if (columnSet === undefined || !columnSet.has(column)) {
    return { drifted: true, reason: 'schema_reference_missing' };
  }

  return { drifted: false, reason: 'schema_reference_present' };
}

/**
 * API-endpoint checker for `kind === 'api'` references.
 *
 * The reference is matched as a regex against the corpus. A
 * `count === 0` outcome is `{ drifted: true, reason:
 * 'api_reference_missing' }` (no source file declares the
 * endpoint) and `count > 0` is `{ drifted: false, reason:
 * 'api_reference_present' }`. The regex is constructed by
 * escaping the reference except for the `/path` tail (which is
 * treated as a literal), so an attacker-controlled metadata
 * value cannot inject arbitrary regex flags or metacharacters
 * into the corpus scan.
 *
 * The checker is async because `MemoryDriftCodeCorpus.search`
 * is async — the concrete corpus reads files lazily on first
 * match attempt.
 */
export async function checkApiDrift(
  reference: string,
  codeCorpus: MemoryDriftCodeCorpus,
): Promise<MemoryDriftCheckerResult> {
  const pattern = buildApiReferencePattern(reference);
  const matchCount = await codeCorpus.search(pattern);
  if (matchCount === 0) {
    return { drifted: true, reason: 'api_reference_missing' };
  }
  return { drifted: false, reason: 'api_reference_present' };
}

/**
 * Build a regex from an `apiEndpoint` reference. The reference is
 * `METHOD /path` (e.g. `GET /v1/orders/{id}`). The method is
 * preserved as a literal token and the path tail is escaped so
 * the regex is safe to apply against the corpus without further
 * sanitisation.
 *
 * Curly-brace path parameters are escaped as-is (`{id}` stays
 * `{id}` in the escaped pattern — the regex matches the literal
 * token, which is the common NestJS / Express route declaration).
 */
function buildApiReferencePattern(reference: string): RegExp {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped);
}

/**
 * NestJS-injectable wrapper around the three pure checkers.
 * The detector service resolves the wrapper through DI so a
 * unit test can substitute a stub via constructor injection
 * (mirroring the parser pattern). The wrapper is intentionally
 * thin: every method delegates to the matching pure function so
 * the behaviour is identical to the standalone exports.
 */
@Injectable()
export class MemoryDriftCheckers {
  checkFile(
    reference: string,
    repoRoot: string,
  ): Promise<MemoryDriftCheckerResult> {
    return checkFileDrift(reference, repoRoot);
  }

  checkSchema(
    reference: string,
    schemaIndex: ReadonlyMap<string, ReadonlySet<string>>,
  ): MemoryDriftCheckerResult {
    return checkSchemaDrift(reference, schemaIndex);
  }

  checkApi(
    reference: string,
    codeCorpus: MemoryDriftCodeCorpus,
  ): Promise<MemoryDriftCheckerResult> {
    return checkApiDrift(reference, codeCorpus);
  }
}
