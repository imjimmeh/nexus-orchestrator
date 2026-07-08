import { describe, expect, it } from 'vitest';
import { PROBATION_REASONS, decideProbation } from './memory-probation.decide';
import type {
  ProbationInput,
  ProbationThresholds,
} from './memory-probation.decide.types';

const NOW_MS = 1_000_000;
const THRESHOLDS: ProbationThresholds = {
  confirmThreshold: 0.6,
  minSamples: 3,
};

function input(overrides: Partial<ProbationInput> = {}): ProbationInput {
  return {
    segmentId: 'seg-1',
    usefulness: null,
    sampleSize: 0,
    accessCount: 5,
    contradicted: false,
    drifted: false,
    injectedAndHelped: false,
    // Default: past probation (window elapsed one second ago).
    probationUntilMs: NOW_MS - 1000,
    ...overrides,
  };
}

describe('decideProbation', () => {
  describe('inside probation', () => {
    it('holds when the probation window has not elapsed', () => {
      const verdict = decideProbation(
        input({ probationUntilMs: NOW_MS + 1000 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('hold');
      expect(verdict.reason).toBe(PROBATION_REASONS.insideProbation);
    });

    it('holds inside probation even when hard revert signals are present', () => {
      const verdict = decideProbation(
        input({
          probationUntilMs: NOW_MS + 1000,
          contradicted: true,
          drifted: true,
          accessCount: 0,
        }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('hold');
    });

    it('treats probationUntilMs === nowMs as past probation', () => {
      const verdict = decideProbation(
        input({ probationUntilMs: NOW_MS, accessCount: 0 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
    });

    it('treats a null probationUntilMs as past probation', () => {
      const verdict = decideProbation(
        input({ probationUntilMs: null, usefulness: 0.9, sampleSize: 5 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('confirm');
    });
  });

  describe('hard revert signals (win even with few votes)', () => {
    it('reverts a contradicted (superseded) segment regardless of usefulness', () => {
      const verdict = decideProbation(
        input({ contradicted: true, usefulness: 1, sampleSize: 50 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
      expect(verdict.reason).toBe(PROBATION_REASONS.contradicted);
    });

    it('reverts a drifted segment regardless of usefulness', () => {
      const verdict = decideProbation(
        input({ drifted: true, usefulness: 1, sampleSize: 50 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
      expect(verdict.reason).toBe(PROBATION_REASONS.drifted);
    });

    it('reverts an unused (accessCount === 0) segment with no votes', () => {
      const verdict = decideProbation(
        input({ accessCount: 0 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
      expect(verdict.reason).toBe(PROBATION_REASONS.unused);
    });

    it('hard revert wins over an injected-and-helped confirm', () => {
      const verdict = decideProbation(
        input({ contradicted: true, injectedAndHelped: true }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
    });
  });

  describe('confirm', () => {
    it('confirms when usefulness >= threshold with enough votes', () => {
      const verdict = decideProbation(
        input({ usefulness: 0.6, sampleSize: 3 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('confirm');
      expect(verdict.reason).toBe(PROBATION_REASONS.useful);
    });

    it('confirms on injected-and-helped even without votes', () => {
      const verdict = decideProbation(
        input({ injectedAndHelped: true }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('confirm');
      expect(verdict.reason).toBe(PROBATION_REASONS.injectedAndHelped);
    });

    it('echoes usefulness + sampleSize onto the verdict', () => {
      const verdict = decideProbation(
        input({ usefulness: 0.75, sampleSize: 4 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.usefulness).toBe(0.75);
      expect(verdict.sampleSize).toBe(4);
      expect(verdict.segmentId).toBe('seg-1');
    });
  });

  describe('low-usefulness revert', () => {
    it('reverts when usefulness < threshold with enough votes', () => {
      const verdict = decideProbation(
        input({ usefulness: 0.4, sampleSize: 5 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('revert');
      expect(verdict.reason).toBe(PROBATION_REASONS.lowUsefulness);
    });
  });

  describe('hold (insufficient votes, no hard signal)', () => {
    it('holds when votes are below minSamples and no hard signal fires', () => {
      const verdict = decideProbation(
        input({ usefulness: 0.2, sampleSize: 2 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('hold');
      expect(verdict.reason).toBe(PROBATION_REASONS.insufficientVotes);
    });

    it('holds a never-voted but accessed segment past probation', () => {
      const verdict = decideProbation(
        input({ usefulness: null, sampleSize: 0, accessCount: 7 }),
        THRESHOLDS,
        NOW_MS,
      );
      expect(verdict.action).toBe('hold');
      expect(verdict.reason).toBe(PROBATION_REASONS.insufficientVotes);
    });
  });
});
