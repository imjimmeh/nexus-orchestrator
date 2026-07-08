import { describe, expect, it } from 'vitest';
import { resolveHoldoutArm } from './holdout-bucket.helper';

describe('resolveHoldoutArm', () => {
  it('puts every scope in the injected arm when fraction <= 0 (default-inert)', () => {
    for (const scope of ['a', 'b', 'project-123', 'run-xyz']) {
      expect(resolveHoldoutArm(scope, 0)).toBe('injected');
      expect(resolveHoldoutArm(scope, -0.5)).toBe('injected');
    }
  });

  it('puts every scope in the holdout arm when fraction >= 1', () => {
    for (const scope of ['a', 'b', 'project-123']) {
      expect(resolveHoldoutArm(scope, 1)).toBe('holdout');
    }
  });

  it('is deterministic / stable for a given scope + fraction', () => {
    const first = resolveHoldoutArm('project-stable', 0.5);
    for (let i = 0; i < 5; i += 1) {
      expect(resolveHoldoutArm('project-stable', 0.5)).toBe(first);
    }
  });

  it('never buckets an empty scope id', () => {
    expect(resolveHoldoutArm('', 1)).toBe('injected');
  });

  it('approximates the requested fraction across many scopes', () => {
    const total = 2000;
    let holdout = 0;
    for (let i = 0; i < total; i += 1) {
      if (resolveHoldoutArm(`scope-${i}`, 0.3) === 'holdout') {
        holdout += 1;
      }
    }
    const ratio = holdout / total;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.4);
  });
});
