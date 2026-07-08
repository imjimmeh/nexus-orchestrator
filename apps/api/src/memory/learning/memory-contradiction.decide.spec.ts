import { describe, expect, it } from 'vitest';
import { decideContradiction } from './memory-contradiction.decide';
import type { ContradictionThresholds } from './memory-contradiction.types';

const thresholds: ContradictionThresholds = { similarityThreshold: 0.85 };

describe('decideContradiction', () => {
  it('returns none when there is no neighbour', () => {
    const decision = decideContradiction({
      nearest: null,
      stance: null,
      thresholds,
    });
    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('no_near_candidate');
    expect(decision.similarity).toBe(0);
  });

  it('returns none when the neighbour is below threshold', () => {
    const decision = decideContradiction({
      nearest: { ownerId: 'seg-1', score: 0.5 },
      stance: 'oppose',
      thresholds,
    });
    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('no_near_candidate');
    expect(decision.similarity).toBe(0.5);
  });

  it('maps oppose to supersede', () => {
    const decision = decideContradiction({
      nearest: { ownerId: 'seg-1', score: 0.92 },
      stance: 'oppose',
      thresholds,
    });
    expect(decision).toEqual({
      kind: 'supersede',
      reason: 'opposing_stance',
      existingSegmentId: 'seg-1',
      similarity: 0.92,
    });
  });

  it('maps refine to version', () => {
    const decision = decideContradiction({
      nearest: { ownerId: 'seg-1', score: 0.9 },
      stance: 'refine',
      thresholds,
    });
    expect(decision.kind).toBe('version');
    expect(decision.existingSegmentId).toBe('seg-1');
  });

  it('maps ambiguous to ambiguous', () => {
    const decision = decideContradiction({
      nearest: { ownerId: 'seg-1', score: 0.88 },
      stance: 'ambiguous',
      thresholds,
    });
    expect(decision.kind).toBe('ambiguous');
    expect(decision.existingSegmentId).toBe('seg-1');
  });

  it('maps same stance to none (dedup, not contradiction)', () => {
    const decision = decideContradiction({
      nearest: { ownerId: 'seg-1', score: 0.95 },
      stance: 'same',
      thresholds,
    });
    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('same_stance_dedup');
  });
});
