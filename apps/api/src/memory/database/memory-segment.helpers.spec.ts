import { describe, expect, it } from 'vitest';
import { readConfidence } from './memory-segment.helpers';
import type { MemorySegment } from './entities/memory-segment.entity';

/**
 * Direct unit tests for the `readConfidence` helper extracted from
 * `MemoryDecayReaperService` / `MemoryDriftDetectionService` in
 * Milestone 1. These cases pin the helper's contract — every shape
 * of `metadata_json` a real DB row can carry — so future drift
 * between the two services (or new callers) breaks here, before
 * it breaks the reaper or detector.
 *
 * The helper is pure: it takes a `MemorySegment`-shaped object and
 * returns a finite `number` or `null`. No NestJS TestingModule is
 * needed; fixtures are plain object literals cast to the entity
 * type because the helper only reads `metadata_json`.
 */
describe('readConfidence', () => {
  it('returns null when metadata_json is null', () => {
    const segment = { metadata_json: null } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when metadata_json is undefined', () => {
    const segment = {
      metadata_json: undefined,
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when metadata_json is empty', () => {
    const segment = { metadata_json: {} } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when confidence is a string', () => {
    const segment = {
      metadata_json: { confidence: '0.5' },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when confidence is NaN', () => {
    const segment = {
      metadata_json: { confidence: Number.NaN },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when confidence is Infinity', () => {
    const segment = {
      metadata_json: { confidence: Number.POSITIVE_INFINITY },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns null when confidence is -Infinity', () => {
    const segment = {
      metadata_json: { confidence: Number.NEGATIVE_INFINITY },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBeNull();
  });

  it('returns 0 when confidence is 0', () => {
    const segment = {
      metadata_json: { confidence: 0 },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBe(0);
  });

  it('returns 1 when confidence is 1', () => {
    const segment = {
      metadata_json: { confidence: 1 },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBe(1);
  });

  it('returns 0.5 when confidence is 0.5', () => {
    const segment = {
      metadata_json: { confidence: 0.5 },
    } as unknown as MemorySegment;
    expect(readConfidence(segment)).toBe(0.5);
  });
});
