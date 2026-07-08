import { describe, expect, it } from 'vitest';
import { armRatio, computeLift } from './learning-lift.helper';

describe('armRatio', () => {
  it('is successes / runs', () => {
    expect(armRatio({ runs: 4, successes: 3 })).toBeCloseTo(0.75);
  });

  it('is 0 when the arm has no runs', () => {
    expect(armRatio({ runs: 0, successes: 0 })).toBe(0);
  });
});

describe('computeLift', () => {
  it('is null when the holdout arm has no runs (default-inert)', () => {
    expect(
      computeLift({ runs: 10, successes: 8 }, { runs: 0, successes: 0 }),
    ).toBeNull();
  });

  it('is injected ratio minus holdout ratio from a two-arm fixture', () => {
    // injected: 8/10 = 0.8 ; holdout: 2/10 = 0.2 ; lift = 0.6
    const lift = computeLift(
      { runs: 10, successes: 8 },
      { runs: 10, successes: 2 },
    );
    expect(lift).toBeCloseTo(0.6);
  });

  it('can be negative when injection hurt the success rate', () => {
    const lift = computeLift(
      { runs: 4, successes: 1 },
      { runs: 4, successes: 3 },
    );
    expect(lift).toBeCloseTo(0.25 - 0.75);
  });
});
