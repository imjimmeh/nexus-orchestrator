import { describe, expect, it } from 'vitest';
import {
  LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
  LEARNING_CONVERGENCE_WINDOW_DAYS_MAX,
  LEARNING_CONVERGENCE_WINDOW_DAYS_MIN,
  LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING,
  coerceLearningConvergenceWindowDays,
} from './learning-convergence-settings.constants';

describe('learning-convergence-settings constants', () => {
  it('uses the well-known learning_convergence_window_days key', () => {
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_SETTING).toBe(
      'learning_convergence_window_days',
    );
  });

  it('keeps a coherent default and bounds for the rolling window', () => {
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT).toBe(7);
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_MIN).toBeLessThan(
      LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT,
    );
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_DEFAULT).toBeLessThan(
      LEARNING_CONVERGENCE_WINDOW_DAYS_MAX,
    );
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_MIN).toBe(1);
    expect(LEARNING_CONVERGENCE_WINDOW_DAYS_MAX).toBe(90);
  });
});

describe('coerceLearningConvergenceWindowDays', () => {
  it('returns the value when it is a finite integer in range', () => {
    expect(coerceLearningConvergenceWindowDays(1)).toBe(1);
    expect(coerceLearningConvergenceWindowDays(7)).toBe(7);
    expect(coerceLearningConvergenceWindowDays(90)).toBe(90);
  });

  it('falls back to the hardcoded default for missing / non-numeric / out-of-range values', () => {
    expect(coerceLearningConvergenceWindowDays(undefined)).toBe(7);
    expect(coerceLearningConvergenceWindowDays('7')).toBe(7);
    expect(coerceLearningConvergenceWindowDays(Number.NaN)).toBe(7);
    expect(coerceLearningConvergenceWindowDays(0)).toBe(7);
    expect(coerceLearningConvergenceWindowDays(91)).toBe(7);
    expect(coerceLearningConvergenceWindowDays(-1)).toBe(7);
  });

  it('uses the explicit fallback when supplied', () => {
    expect(coerceLearningConvergenceWindowDays(0, 14)).toBe(14);
    expect(coerceLearningConvergenceWindowDays('oops', 30)).toBe(30);
  });
});
