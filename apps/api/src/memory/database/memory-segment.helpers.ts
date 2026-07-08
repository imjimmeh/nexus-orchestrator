import type { MemorySegment } from './entities/memory-segment.entity';

/**
 * Read the `confidence` value from a segment's `metadata_json`
 * blob. The canonical storage shape is
 * `metadata_json.confidence: number` in the `[0, 1]` range
 * (written by the learning promotion pipeline). A row with no
 * `metadata_json` blob, no `confidence` key, or a non-numeric
 * `confidence` value yields `null` and the caller treats the
 * row as ineligible — the helper never invents a confidence
 * value from scratch.
 *
 * Co-located with the {@link MemorySegment} entity per the
 * project's documented "domain-local" pattern (see the comment
 * in `apps/api/src/memory/database/repositories/memory-segment-feedback.repository.ts`).
 */
export function readConfidence(segment: MemorySegment): number | null {
  const metadata = segment.metadata_json;
  if (metadata === null || metadata === undefined) {
    return null;
  }
  const value = metadata['confidence'];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}
