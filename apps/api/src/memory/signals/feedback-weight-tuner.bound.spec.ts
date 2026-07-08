import { describe, expect, it } from 'vitest';
import { boundWeights } from './feedback-weight-tuner.bound';
import type { ScoringWeightVector } from './feedback-weight-tuner.types';

const CURRENT: ScoringWeightVector = {
  w_recurrence: 0.4,
  w_source_quality: 0.8,
  w_recency: 0.6,
  w_diversity: 0.3,
  beta: -1.0,
};

const MAX_DELTA = 0.1;

const WEIGHT_KEYS: Array<keyof ScoringWeightVector> = [
  'w_recurrence',
  'w_source_quality',
  'w_recency',
  'w_diversity',
  'beta',
];

describe('boundWeights', () => {
  it('clamps a large upward proposed move to current + maxDelta', () => {
    const proposed: ScoringWeightVector = {
      w_recurrence: 5.0,
      w_source_quality: 5.0,
      w_recency: 5.0,
      w_diversity: 5.0,
      beta: 5.0,
    };

    const { bounded } = boundWeights(proposed, CURRENT, MAX_DELTA);

    for (const key of WEIGHT_KEYS) {
      expect(bounded[key]).toBeCloseTo(CURRENT[key] + MAX_DELTA, 10);
    }
  });

  it('clamps a large downward proposed move to current - maxDelta', () => {
    const proposed: ScoringWeightVector = {
      w_recurrence: -5.0,
      w_source_quality: -5.0,
      w_recency: -5.0,
      w_diversity: -5.0,
      beta: -5.0,
    };

    const { bounded } = boundWeights(proposed, CURRENT, MAX_DELTA);

    for (const key of WEIGHT_KEYS) {
      expect(bounded[key]).toBeCloseTo(CURRENT[key] - MAX_DELTA, 10);
    }
  });

  it('never moves a single weight more than maxDelta from the prior', () => {
    const proposed: ScoringWeightVector = {
      w_recurrence: 0.41, // within bound
      w_source_quality: 99, // far above
      w_recency: -99, // far below
      w_diversity: 0.3, // unchanged
      beta: -1.05, // within bound
    };

    const { bounded } = boundWeights(proposed, CURRENT, MAX_DELTA);

    for (const key of WEIGHT_KEYS) {
      expect(Math.abs(bounded[key] - CURRENT[key])).toBeLessThanOrEqual(
        MAX_DELTA + 1e-9,
      );
    }
  });

  it('leaves a within-bound proposed weight unchanged', () => {
    const proposed: ScoringWeightVector = {
      ...CURRENT,
      w_recurrence: 0.45,
    };

    const { bounded } = boundWeights(proposed, CURRENT, MAX_DELTA);

    expect(bounded.w_recurrence).toBeCloseTo(0.45, 10);
    expect(bounded.w_source_quality).toBeCloseTo(CURRENT.w_source_quality, 10);
  });

  it('reports boundedDelta as the largest applied change magnitude', () => {
    const proposed: ScoringWeightVector = {
      ...CURRENT,
      w_recurrence: 0.42, // delta 0.02
      w_recency: 99, // clamped to delta 0.1
    };

    const { boundedDelta } = boundWeights(proposed, CURRENT, MAX_DELTA);

    expect(boundedDelta).toBeCloseTo(0.1, 10);
  });

  it('reports a zero boundedDelta when nothing moves', () => {
    const { boundedDelta } = boundWeights(CURRENT, CURRENT, MAX_DELTA);
    expect(boundedDelta).toBe(0);
  });
});
