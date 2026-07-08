import { describe, expect, it } from 'vitest';
import {
  deriveCandidateLabel,
  extractCandidateFeatures,
} from './feedback-weight-tuner.labels';

const THRESHOLDS = { usefulnessThreshold: 0.6, minVotes: 3 };

describe('deriveCandidateLabel', () => {
  it('labels a high-usefulness, live segment as positive (1)', () => {
    const label = deriveCandidateLabel(
      { archived: false, superseded: false, usefulness: 0.9, sampleSize: 5 },
      THRESHOLDS,
    );
    expect(label).toBe(1);
  });

  it('labels a low-usefulness voted segment as negative (0)', () => {
    const label = deriveCandidateLabel(
      { archived: false, superseded: false, usefulness: 0.2, sampleSize: 5 },
      THRESHOLDS,
    );
    expect(label).toBe(0);
  });

  it('labels an archived (reverted) segment as negative regardless of usefulness', () => {
    const label = deriveCandidateLabel(
      { archived: true, superseded: false, usefulness: 0.95, sampleSize: 10 },
      THRESHOLDS,
    );
    expect(label).toBe(0);
  });

  it('labels a superseded (contradicted) segment as negative', () => {
    const label = deriveCandidateLabel(
      { archived: false, superseded: true, usefulness: null, sampleSize: 0 },
      THRESHOLDS,
    );
    expect(label).toBe(0);
  });

  it('returns null (unlabelled) for a never-voted, live segment', () => {
    const label = deriveCandidateLabel(
      { archived: false, superseded: false, usefulness: null, sampleSize: 0 },
      THRESHOLDS,
    );
    expect(label).toBeNull();
  });

  it('returns null when votes are below the minimum threshold', () => {
    const label = deriveCandidateLabel(
      { archived: false, superseded: false, usefulness: 0.9, sampleSize: 2 },
      THRESHOLDS,
    );
    expect(label).toBeNull();
  });
});

describe('extractCandidateFeatures', () => {
  it('returns features in [log-recurrence, source_quality, recency, diversity] order', () => {
    const features = extractCandidateFeatures(
      {
        recurrence_count: Math.E, // log(e) = 1
        source_quality_confidence: 0.8,
        recency_decay: 0.5,
        stage_diversity_count: 2,
      },
      5,
    );
    expect(features).toHaveLength(4);
    expect(features[0]).toBeCloseTo(1, 10); // log(e)
    expect(features[1]).toBeCloseTo(0.8, 10);
    expect(features[2]).toBeCloseTo(0.5, 10);
    expect(features[3]).toBeCloseTo(2 / 5, 10); // diversity norm
  });

  it('guards recurrence_count < 1 so log() never returns -Infinity', () => {
    const features = extractCandidateFeatures(
      {
        recurrence_count: 0,
        source_quality_confidence: 0.5,
        recency_decay: 1,
        stage_diversity_count: 1,
      },
      5,
    );
    expect(features[0]).toBe(0); // log(max(1,0)) = log(1) = 0
    expect(Number.isFinite(features[0])).toBe(true);
  });

  it('caps the diversity norm at 1 when stage diversity exceeds the cap', () => {
    const features = extractCandidateFeatures(
      {
        recurrence_count: 1,
        source_quality_confidence: 0.5,
        recency_decay: 1,
        stage_diversity_count: 99,
      },
      5,
    );
    expect(features[3]).toBe(1);
  });
});
