import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FREEZE_BUDGET_MS,
  MAX_FREEZE_BUDGET_MS,
  resolveFreezeBudgetMs,
} from './freeze.contracts';

describe('resolveFreezeBudgetMs', () => {
  it('returns the default when raw is undefined', () => {
    expect(resolveFreezeBudgetMs(undefined)).toBe(DEFAULT_FREEZE_BUDGET_MS);
    expect(DEFAULT_FREEZE_BUDGET_MS).toBe(20_000);
  });

  it('clamps values above the hard cap to MAX_FREEZE_BUDGET_MS', () => {
    expect(resolveFreezeBudgetMs('35000')).toBe(MAX_FREEZE_BUDGET_MS);
    expect(MAX_FREEZE_BUDGET_MS).toBe(25_000);
  });

  it('returns a normal in-range value unchanged', () => {
    expect(resolveFreezeBudgetMs('8000')).toBe(8_000);
  });

  it('returns the default for invalid or non-positive values', () => {
    expect(resolveFreezeBudgetMs('0')).toBe(DEFAULT_FREEZE_BUDGET_MS);
    expect(resolveFreezeBudgetMs('-1')).toBe(DEFAULT_FREEZE_BUDGET_MS);
    expect(resolveFreezeBudgetMs('not-a-number')).toBe(
      DEFAULT_FREEZE_BUDGET_MS,
    );
  });
});
