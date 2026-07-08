import { Injectable } from '@nestjs/common';
import type { MemoryDriftParsedReference } from './memory-drift.types';

/**
 * Pure parser that extracts a drift-checkable reference from a
 * `MemorySegment.source_metadata` blob (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * The metadata schema is intentionally narrow: the detector
 * service does not need to inspect every field of the metadata
 * blob, only the small subset of keys that point at code-level
 * reality (a repo path, a schema column, or an API endpoint).
 * The parser recognises three shapes:
 *
 *   - `{ filePath: string }`              → `{ kind: 'file',   reference: <filePath> }`
 *   - `{ schemaRef: string }`             → `{ kind: 'schema', reference: <schemaRef> }`
 *   - `{ apiEndpoint: string }`           → `{ kind: 'api',    reference: <apiEndpoint> }`
 *
 * Anything else (a missing key, a non-string value, an
 * unparseable `schemaRef`, an `apiEndpoint` without a method
 * prefix, …) returns `null` so the detector service can short-
 * circuit with `no_driftable_reference` and count the row in
 * `checkedCount` without invoking a checker.
 *
 * The parser is a pure function — no I/O, no class state, no
 * dependency injection. Splitting the pure function from the
 * NestJS-injectable wrapper below lets unit tests pin the
 * classification rules without spinning up the full NestJS DI
 * container, and lets the service swap in a parser stub via
 * constructor injection (the milestone-4 test milestone will
 * exploit that seam).
 */

/** Recognised HTTP method prefixes for `apiEndpoint` references. */
const API_METHOD_PREFIX_PATTERN =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//i;

/**
 * Schema-reference shape: `table.column` (the documented minimum)
 * or `table.column.field` (a three-segment form that the parser
 * accepts for callers that want to point at a column + a path
 * into the column's structured payload). The checkers receive
 * the full reference string and apply their own truncation
 * rules — the schema checker only inspects `table.column`.
 */
const SCHEMA_REF_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * File-path shape: a non-empty string that is not a URL and does
 * not start with `/`. Absolute paths and URL references are
 * rejected at the parser so the file checker never has to defend
 * against `file:///etc/passwd` or `https://…` strings — those are
 * the wrong shape for a "drift against this repo's files" check.
 */
const FILE_PATH_PATTERN = /^[^/\s][^\s]*$/;

/**
 * Extract a drift-checkable reference from a
 * `MemorySegment.source_metadata` blob. Returns `null` for
 * unknown / unparseable / non-applicable metadata so the
 * detector service can short-circuit with
 * `no_driftable_reference` and leave the row untouched.
 *
 * The function is intentionally defensive: it inspects only the
 * three documented keys (`filePath`, `schemaRef`, `apiEndpoint`)
 * and never inspects `source`, `content`, `confidence`, or any
 * other metadata field. A row that points at e.g. a `repoUrl`
 * or `commitSha` is not drift-checkable from this pass — those
 * are operator-managed, not code-managed, and the detector
 * service must not start reasoning about them in this milestone.
 *
 * @param sourceMetadata - The `metadata_json` blob from a
 *   `MemorySegment` row. Expected to be a plain object; any other
 *   shape (array, primitive, null) yields `null` from the parser.
 */
export function parseMemoryDriftReference(
  sourceMetadata: unknown,
): MemoryDriftParsedReference | null {
  if (sourceMetadata === null || sourceMetadata === undefined) {
    return null;
  }
  if (typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) {
    return null;
  }

  const metadata = sourceMetadata as Record<string, unknown>;

  const filePath = metadata['filePath'];
  if (typeof filePath === 'string' && filePath.trim().length > 0) {
    const trimmed = filePath.trim();
    if (FILE_PATH_PATTERN.test(trimmed)) {
      return { kind: 'file', reference: trimmed };
    }
  }

  const schemaRef = metadata['schemaRef'];
  if (typeof schemaRef === 'string' && schemaRef.trim().length > 0) {
    const trimmed = schemaRef.trim();
    if (SCHEMA_REF_PATTERN.test(trimmed)) {
      return { kind: 'schema', reference: trimmed };
    }
  }

  const apiEndpoint = metadata['apiEndpoint'];
  if (typeof apiEndpoint === 'string' && apiEndpoint.trim().length > 0) {
    const trimmed = apiEndpoint.trim();
    if (API_METHOD_PREFIX_PATTERN.test(trimmed)) {
      return { kind: 'api', reference: trimmed };
    }
  }

  return null;
}

/**
 * NestJS-injectable wrapper around {@link parseMemoryDriftReference}.
 * The wrapper exists for two reasons:
 *
 *   1. The detector service resolves the parser through DI (so a
 *      unit test can substitute a stub via constructor injection).
 *   2. Future milestones that add additional reference shapes
 *      (e.g. GraphQL operation names, RPC service identifiers)
 *      can extend the wrapper without touching the pure function
 *      that callers may also import directly for offline tools.
 *
 * The wrapper is intentionally thin: every call delegates to the
 * pure function so the behaviour is identical to the standalone
 * export. There is no caching, normalisation, or side effect —
 * the parser is pure and the wrapper must remain so.
 */
@Injectable()
export class MemoryDriftReferenceParser {
  parse(sourceMetadata: unknown): MemoryDriftParsedReference | null {
    return parseMemoryDriftReference(sourceMetadata);
  }
}
