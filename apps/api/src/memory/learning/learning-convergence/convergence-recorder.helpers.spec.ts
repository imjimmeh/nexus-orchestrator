/**
 * Unit tests for the pure convergence recorder helpers (work
 * item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2,
 * AC-1).
 *
 * Exhaustive coverage of:
 *   - `buildUsefulnessHistogram` — 10 numeric bins + the
 *     `unknown` bin (AC-1 + AC-5).
 *   - `buildRetentionDecisionDistribution` — the closed reason
 *     set + the `null` key.
 *   - `recalculateUsefulnessThreshold` — the min-observed rule
 *     + the min-samples short-circuit.
 *   - `classifyUsefulnessValue` — bin-edge cases (0.0, 0.1,
 *     0.95, 1.0 inclusive, > 1.0, < 0.0, NaN, null,
 *     undefined).
 *
 * No DB, no NestJS — these are pure-function tests.
 */

import { describe, expect, it } from 'vitest';
import {
  RETENTION_DECISION_KEEP_REASON_KEYS,
  RETENTION_DECISION_KEEP_REASON_SET,
  RETENTION_DECISION_NULL_KEY,
  RETENTION_DECISION_REASON_KEYS,
  USEFULNESS_HISTOGRAM_BIN_COUNT,
  USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
  buildRetentionDecisionDistribution,
  buildUsefulnessHistogram,
  classifyUsefulnessValue,
  computeKeepFraction,
  recalculateUsefulnessThreshold,
} from './convergence-recorder.helpers';

describe('classifyUsefulnessValue', () => {
  it('buckets 0.0 into bin 0', () => {
    expect(classifyUsefulnessValue(0)).toBe('0');
  });

  it('buckets 0.05 into bin 0', () => {
    expect(classifyUsefulnessValue(0.05)).toBe('0');
  });

  it('buckets 0.1 into bin 1 (the lower edge of the second bucket)', () => {
    // The bucket is [0.1, 0.2). A value exactly at 0.1 lands
    // in bin 1 because Math.floor(0.1 / 0.1) === 1.
    expect(classifyUsefulnessValue(0.1)).toBe('1');
  });

  it('buckets 0.95 into bin 9 (the last numeric bucket)', () => {
    expect(classifyUsefulnessValue(0.95)).toBe('9');
  });

  it('buckets 1.0 into bin 9 (inclusive upper edge)', () => {
    expect(classifyUsefulnessValue(1.0)).toBe('9');
  });

  it('buckets values above 1.0 into the unknown bin', () => {
    expect(classifyUsefulnessValue(1.01)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
    expect(classifyUsefulnessValue(2)).toBe(USEFULNESS_HISTOGRAM_UNKNOWN_KEY);
  });

  it('buckets negative values into the unknown bin', () => {
    expect(classifyUsefulnessValue(-0.1)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
    expect(classifyUsefulnessValue(-1)).toBe(USEFULNESS_HISTOGRAM_UNKNOWN_KEY);
  });

  it('buckets NaN / Infinity / -Infinity into the unknown bin', () => {
    expect(classifyUsefulnessValue(Number.NaN)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
    expect(classifyUsefulnessValue(Number.POSITIVE_INFINITY)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
    expect(classifyUsefulnessValue(Number.NEGATIVE_INFINITY)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
  });

  it('buckets null / undefined into the unknown bin', () => {
    expect(classifyUsefulnessValue(null)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
    expect(classifyUsefulnessValue(undefined)).toBe(
      USEFULNESS_HISTOGRAM_UNKNOWN_KEY,
    );
  });
});

describe('buildUsefulnessHistogram', () => {
  it('returns an all-zero 10-bin + unknown payload for an empty input', () => {
    const histogram = buildUsefulnessHistogram([]);
    expect(histogram).toEqual({
      '0': 0,
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
      '6': 0,
      '7': 0,
      '8': 0,
      '9': 0,
      [USEFULNESS_HISTOGRAM_UNKNOWN_KEY]: 0,
    });
  });

  it('counts one value into its bucket', () => {
    const histogram = buildUsefulnessHistogram([0.5]);
    expect(histogram['5']).toBe(1);
    for (const key of Object.keys(histogram)) {
      if (key !== '5') {
        expect(histogram[key]).toBe(0);
      }
    }
  });

  it('counts multiple values across buckets', () => {
    const histogram = buildUsefulnessHistogram([0.0, 0.1, 0.95, 1.0]);
    expect(histogram['0']).toBe(1);
    expect(histogram['1']).toBe(1);
    expect(histogram['9']).toBe(2);
    expect(histogram[USEFULNESS_HISTOGRAM_UNKNOWN_KEY]).toBe(0);
  });

  it('counts null / NaN / out-of-range inputs into the unknown bin', () => {
    const histogram = buildUsefulnessHistogram([
      null,
      undefined,
      Number.NaN,
      2,
      -0.5,
      0.5,
    ]);
    expect(histogram[USEFULNESS_HISTOGRAM_UNKNOWN_KEY]).toBe(5);
    expect(histogram['5']).toBe(1);
  });

  it('returns a payload with the canonical key set', () => {
    const histogram = buildUsefulnessHistogram([0.5]);
    expect(Object.keys(histogram)).toHaveLength(
      USEFULNESS_HISTOGRAM_BIN_COUNT + 1,
    );
    expect(histogram[USEFULNESS_HISTOGRAM_UNKNOWN_KEY]).toBe(0);
  });
});

describe('buildRetentionDecisionDistribution', () => {
  it('returns an all-zero payload for an empty input', () => {
    const distribution = buildRetentionDecisionDistribution([]);
    expect(distribution).toEqual({
      pinned: 0,
      injected_and_helped: 0,
      useful: 0,
      insufficient_samples: 0,
      low_usefulness: 0,
      no_votes: 0,
      [RETENTION_DECISION_NULL_KEY]: 0,
    });
  });

  it('counts one decision into its bucket', () => {
    const distribution = buildRetentionDecisionDistribution(['useful']);
    expect(distribution['useful']).toBe(1);
    for (const key of RETENTION_DECISION_REASON_KEYS) {
      if (key !== 'useful') {
        expect(distribution[key]).toBe(0);
      }
    }
    expect(distribution[RETENTION_DECISION_NULL_KEY]).toBe(0);
  });

  it('counts every closed reason code', () => {
    const distribution = buildRetentionDecisionDistribution([
      'pinned',
      'injected_and_helped',
      'useful',
      'insufficient_samples',
      'low_usefulness',
      'no_votes',
    ]);
    expect(distribution['pinned']).toBe(1);
    expect(distribution['injected_and_helped']).toBe(1);
    expect(distribution['useful']).toBe(1);
    expect(distribution['insufficient_samples']).toBe(1);
    expect(distribution['low_usefulness']).toBe(1);
    expect(distribution['no_votes']).toBe(1);
    expect(distribution[RETENTION_DECISION_NULL_KEY]).toBe(0);
  });

  it('counts null / undefined verdicts into the null bucket', () => {
    const distribution = buildRetentionDecisionDistribution([
      null,
      undefined,
      'useful',
    ]);
    expect(distribution[RETENTION_DECISION_NULL_KEY]).toBe(2);
    expect(distribution['useful']).toBe(1);
  });

  it('preserves the canonical key order from RETENTION_DECISION_REASON_KEYS', () => {
    const distribution = buildRetentionDecisionDistribution([]);
    const keys = Object.keys(distribution);
    expect(keys).toEqual([
      ...RETENTION_DECISION_REASON_KEYS,
      RETENTION_DECISION_NULL_KEY,
    ]);
  });
});

describe('recalculateUsefulnessThreshold', () => {
  it('returns the default threshold when sample size is below the floor', () => {
    const result = recalculateUsefulnessThreshold([0.5, 0.6, 0.7], 5, 0.5);
    expect(result).toEqual({ threshold: 0.5, sampleSize: 3 });
  });

  it('returns the default threshold for an empty input', () => {
    const result = recalculateUsefulnessThreshold([], 10, 0.5);
    expect(result).toEqual({ threshold: 0.5, sampleSize: 0 });
  });

  it('returns the min-observed threshold when sample size meets the floor', () => {
    const result = recalculateUsefulnessThreshold(
      [0.5, 0.6, 0.7, 0.8, 0.9, 0.55, 0.65, 0.75, 0.85, 0.45],
      10,
      0.5,
    );
    expect(result.sampleSize).toBe(10);
    expect(result.threshold).toBeCloseTo(0.45, 6);
  });

  it('filters out null / NaN / non-finite entries before computing the min', () => {
    const result = recalculateUsefulnessThreshold(
      [
        0.5,
        0.6,
        0.7,
        null,
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        0.4,
        0.8,
        0.9,
      ],
      5,
      0.5,
    );
    // 6 finite values survive (the null / undefined / NaN /
    // Infinity entries are filtered out).
    expect(result.sampleSize).toBe(6);
    expect(result.threshold).toBeCloseTo(0.4, 6);
  });

  it('does NOT count filtered entries toward the sample size', () => {
    const result = recalculateUsefulnessThreshold(
      [0.5, 0.6, 0.7, null, null, null, null, null, null, null],
      10,
      0.5,
    );
    expect(result.sampleSize).toBe(3);
    expect(result.threshold).toBe(0.5);
  });

  it('rounds the threshold to 6 decimal places', () => {
    const result = recalculateUsefulnessThreshold(
      [0.123456789, 0.987654321, 0.5, 0.6, 0.7, 0.8, 0.9, 0.55, 0.65, 0.75],
      10,
      0.5,
    );
    expect(result.threshold).toBe(0.123457);
  });
});

describe('RETENTION_DECISION_KEEP_REASON_KEYS', () => {
  it('lists exactly the three `keep === true` reasons', () => {
    expect(RETENTION_DECISION_KEEP_REASON_KEYS).toEqual([
      'pinned',
      'injected_and_helped',
      'useful',
    ]);
  });

  it('is a subset of RETENTION_DECISION_REASON_KEYS', () => {
    for (const key of RETENTION_DECISION_KEEP_REASON_KEYS) {
      expect(RETENTION_DECISION_REASON_KEYS).toContain(key);
    }
  });

  it('builds a matching Set for O(1) `has` lookups', () => {
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('pinned')).toBe(true);
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('injected_and_helped')).toBe(
      true,
    );
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('useful')).toBe(true);
    // Non-keep reasons must NOT match.
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('insufficient_samples')).toBe(
      false,
    );
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('low_usefulness')).toBe(
      false,
    );
    expect(RETENTION_DECISION_KEEP_REASON_SET.has('no_votes')).toBe(false);
  });
});

describe('computeKeepFraction (bound_to_reused_score aggregate)', () => {
  it('returns 0 for an empty decision list', () => {
    expect(computeKeepFraction([])).toBe(0);
  });

  it('returns 0 for an all-null decision list (no real verdicts to score)', () => {
    expect(computeKeepFraction([null, null, undefined, null])).toBe(0);
  });

  it('returns 0.4 for 2 keep / 3 drop over 5 total verdicts', () => {
    // The exact fixture pinned by the service spec — the
    // helper must agree byte-for-byte.
    expect(
      computeKeepFraction([
        'pinned',
        'useful',
        'insufficient_samples',
        'low_usefulness',
        'no_votes',
      ]),
    ).toBe(0.4);
  });

  it('returns 1 for an all-keep input', () => {
    expect(
      computeKeepFraction(['pinned', 'useful', 'injected_and_helped']),
    ).toBe(1);
  });

  it('returns 0 for an all-drop input', () => {
    expect(
      computeKeepFraction([
        'insufficient_samples',
        'low_usefulness',
        'no_votes',
      ]),
    ).toBe(0);
  });

  it('excludes null / undefined entries from both numerator and denominator', () => {
    // 1 keep / 2 drop / 2 null → 1/3, not 1/5.
    expect(
      computeKeepFraction([
        'pinned',
        'insufficient_samples',
        'low_usefulness',
        null,
        undefined,
      ]),
    ).toBeCloseTo(1 / 3, 6);
  });

  it('counts unknown verdict strings as drop (real scan, but no keep)', () => {
    // Defensive: the value predicate only emits known reason
    // codes, but if a future enum widening leaks an unknown
    // reason into the list it must NOT be silently counted as
    // keep — that would inflate the score.
    expect(
      computeKeepFraction(['pinned', 'mystery_reason', 'useful']),
    ).toBeCloseTo(2 / 3, 6);
  });
});
