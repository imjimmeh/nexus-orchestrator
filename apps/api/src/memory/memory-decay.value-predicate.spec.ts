/**
 * Unit tests for the pure usefulness-aware decay value predicate
 * (EPIC-212 Phase-3 Task 2).
 *
 * Exhaustively pins the `decideMemoryRetentionKeep` matrix and the
 * `computeDecayShadowComparison` divergence roll-up. No DB, no NestJS
 * — these are pure-function tests.
 */

import { describe, expect, it } from 'vitest';
import {
  DECAY_KEEP_REASONS,
  computeDecayShadowComparison,
  decideMemoryRetentionKeep,
} from './memory-decay.value-predicate';
import type {
  DecayKeepInput,
  DecayKeepThresholds,
  DecayShadowCandidate,
} from './memory-decay.value-predicate.types';

const THRESHOLDS: DecayKeepThresholds = {
  usefulnessThreshold: 0.6,
  minSamples: 3,
};

function input(overrides: Partial<DecayKeepInput>): DecayKeepInput {
  return {
    pinned: false,
    usefulness: null,
    sampleSize: 0,
    injectedAndHelped: false,
    source: 'general',
    ...overrides,
  };
}

describe('decideMemoryRetentionKeep', () => {
  it('keeps a pinned row regardless of usefulness', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ pinned: true }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({ keep: true, reason: DECAY_KEEP_REASONS.pinned });
  });

  it('keeps a pinned row even when its usefulness is below threshold', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ pinned: true, usefulness: 0.1, sampleSize: 10 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({ keep: true, reason: DECAY_KEEP_REASONS.pinned });
  });

  it('keeps a useful row with enough samples (usefulness >= threshold)', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: 0.8, sampleSize: 5 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({ keep: true, reason: DECAY_KEEP_REASONS.useful });
  });

  it('keeps a row exactly at the usefulness threshold and min samples', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: 0.6, sampleSize: 3 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({ keep: true, reason: DECAY_KEEP_REASONS.useful });
  });

  it('does NOT keep a low-usefulness row with enough votes (low_usefulness)', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: 0.4, sampleSize: 10 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({
      keep: false,
      reason: DECAY_KEEP_REASONS.lowUsefulness,
    });
  });

  it('does NOT keep a never-voted row (usefulness null, 0 samples → no_votes)', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: null, sampleSize: 0 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({
      keep: false,
      reason: DECAY_KEEP_REASONS.noVotes,
    });
  });

  it('does NOT keep a high-usefulness row with too few votes (insufficient_samples)', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: 0.9, sampleSize: 2 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({
      keep: false,
      reason: DECAY_KEEP_REASONS.insufficientSamples,
    });
  });

  it('keeps an injected-and-helped row even when it has no votes', () => {
    const verdict = decideMemoryRetentionKeep(
      input({ injectedAndHelped: true, usefulness: null, sampleSize: 0 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({
      keep: true,
      reason: DECAY_KEEP_REASONS.injectedAndHelped,
    });
  });

  it('treats a zero usefulness (all not-useful) distinctly from never-voted', () => {
    // usefulness 0 with votes is NOT "no_votes" — it is a real
    // low-usefulness signal and must be archive-eligible.
    const verdict = decideMemoryRetentionKeep(
      input({ usefulness: 0, sampleSize: 5 }),
      THRESHOLDS,
    );
    expect(verdict).toEqual({
      keep: false,
      reason: DECAY_KEEP_REASONS.lowUsefulness,
    });
  });
});

describe('computeDecayShadowComparison', () => {
  function candidate(
    overrides: Partial<DecayShadowCandidate>,
  ): DecayShadowCandidate {
    return {
      id: 'seg',
      legacyArchive: false,
      valueKeep: false,
      reason: DECAY_KEEP_REASONS.noVotes,
      ...overrides,
    };
  }

  it('lists a useful-but-stale row as kept-by-value / archived-by-legacy', () => {
    const usefulStale = candidate({
      id: 'useful-stale',
      legacyArchive: true,
      valueKeep: true,
      reason: DECAY_KEEP_REASONS.useful,
    });
    const lowValueStale = candidate({
      id: 'low-stale',
      legacyArchive: true,
      valueKeep: false,
      reason: DECAY_KEEP_REASONS.lowUsefulness,
    });
    const neverVoted = candidate({
      id: 'never-voted',
      legacyArchive: true,
      valueKeep: false,
      reason: DECAY_KEEP_REASONS.noVotes,
    });

    const comparison = computeDecayShadowComparison('shadow', [
      usefulStale,
      lowValueStale,
      neverVoted,
    ]);

    expect(comparison.mode).toBe('shadow');
    expect(comparison.evaluated).toBe(3);
    expect(comparison.legacyArchiveCount).toBe(3);
    // The value predicate archives everything legacy did EXCEPT the
    // useful row it protects.
    expect(comparison.valuePredicateArchiveCount).toBe(2);
    expect(comparison.keptByValueArchivedByLegacy).toEqual(['useful-stale']);
    // A never-voted row is in NEITHER special set — it is archived by
    // both legacy and the value predicate.
    expect(comparison.archivedByValueKeptByLegacy).toEqual([]);
    expect(comparison.keptByValueArchivedByLegacy).not.toContain('never-voted');
  });

  it('is empty on the archived-by-value-kept-by-legacy side (add-only invariant)', () => {
    // A row legacy did NOT archive can never be archived by the value
    // predicate — the predicate only adds protection on top of the
    // confidence floor.
    const inGraceUseful = candidate({
      id: 'in-grace',
      legacyArchive: false,
      valueKeep: true,
      reason: DECAY_KEEP_REASONS.useful,
    });
    const inGraceLowValue = candidate({
      id: 'in-grace-low',
      legacyArchive: false,
      valueKeep: false,
      reason: DECAY_KEEP_REASONS.lowUsefulness,
    });

    const comparison = computeDecayShadowComparison('shadow', [
      inGraceUseful,
      inGraceLowValue,
    ]);

    expect(comparison.legacyArchiveCount).toBe(0);
    expect(comparison.valuePredicateArchiveCount).toBe(0);
    expect(comparison.keptByValueArchivedByLegacy).toEqual([]);
    expect(comparison.archivedByValueKeptByLegacy).toEqual([]);
  });

  it('returns a zeroed comparison for an empty candidate set', () => {
    const comparison = computeDecayShadowComparison('enforce', []);
    expect(comparison).toEqual({
      mode: 'enforce',
      evaluated: 0,
      legacyArchiveCount: 0,
      valuePredicateArchiveCount: 0,
      keptByValueArchivedByLegacy: [],
      archivedByValueKeptByLegacy: [],
    });
  });
});
