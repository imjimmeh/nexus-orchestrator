import type { LessonAnchor } from './lesson-anchor.types';

/**
 * Pure, fail-soft extractor that derives a behaviour-change
 * {@link LessonAnchor} from a promoted lesson's `metadata_json`
 * blob (EPIC-212 Phase 3, Task 1).
 *
 * Contract (Task 4 / Task 6 depend on this):
 *
 * **`path`** is resolved from the first of:
 *   1. a direct string field — `anchored_path`, `filePath`,
 *      `file_path`, or `path`;
 *   2. a `drift_reference` object of `kind: 'file'` (the shape
 *      `MemoryDriftReferenceParser` parses) — its `reference`;
 *   3. an `evidence[]` entry carrying a `path` / `file` /
 *      `filePath` / `file_path` string.
 *
 * **`tool`** is resolved from the first of:
 *   1. a direct string field — `anchored_tool`, `tool`,
 *      `tool_name`, or `toolName`;
 *   2. an `evidence[]` entry carrying a `tool` / `tool_name` /
 *      `toolName` string.
 *
 * Anything else — `null`/`undefined`, a primitive, an array,
 * non-string values, or an empty/garbage blob — yields `{}`.
 * The function never throws and never inspects domain-specific
 * fields, so it is safe to call on every injected lesson.
 *
 * A leg is omitted (not set to `undefined`) when it cannot be
 * resolved, so a lesson with no anchor records byte-identically
 * to the pre-capture behaviour.
 */
const PATH_DIRECT_KEYS = [
  'anchored_path',
  'filePath',
  'file_path',
  'path',
] as const;

const PATH_EVIDENCE_KEYS = ['path', 'file', 'filePath', 'file_path'] as const;

const TOOL_DIRECT_KEYS = [
  'anchored_tool',
  'tool',
  'tool_name',
  'toolName',
] as const;

const TOOL_EVIDENCE_KEYS = ['tool', 'tool_name', 'toolName'] as const;

export function extractLessonAnchor(metadataJson: unknown): LessonAnchor {
  const metadata = asRecord(metadataJson);
  if (!metadata) {
    return {};
  }
  const tool = resolveTool(metadata);
  const path = resolvePath(metadata);
  const anchor: LessonAnchor = {};
  if (tool) {
    anchor.tool = tool;
  }
  if (path) {
    anchor.path = path;
  }
  return anchor;
}

function resolveTool(metadata: Record<string, unknown>): string | undefined {
  const direct = readFirstString(metadata, TOOL_DIRECT_KEYS);
  if (direct) {
    return direct;
  }
  return scanEvidence(metadata, TOOL_EVIDENCE_KEYS);
}

function resolvePath(metadata: Record<string, unknown>): string | undefined {
  const direct = readFirstString(metadata, PATH_DIRECT_KEYS);
  if (direct) {
    return direct;
  }
  const driftPath = readDriftReferenceFilePath(metadata['drift_reference']);
  if (driftPath) {
    return driftPath;
  }
  return scanEvidence(metadata, PATH_EVIDENCE_KEYS);
}

function readDriftReferenceFilePath(value: unknown): string | undefined {
  const reference = asRecord(value);
  if (!reference || reference['kind'] !== 'file') {
    return undefined;
  }
  return readFirstString(reference, ['reference']);
}

function scanEvidence(
  metadata: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | undefined {
  const evidence = metadata['evidence'];
  if (!Array.isArray(evidence)) {
    return undefined;
  }
  for (const entry of evidence) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const found = readFirstString(record, keys);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function readFirstString(
  record: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
