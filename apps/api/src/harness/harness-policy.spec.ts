import { describe, it, expect } from 'vitest';
import { assertMayUseHarness } from './harness-policy';

describe('assertMayUseHarness', () => {
  it('allows when policy scope permits the caller scope', () => {
    expect(() => {
      assertMayUseHarness(
        { scopeNodeId: 'p1', role: 'admin' },
        { policyScope: { projects: ['p1'] } },
      );
    }).not.toThrow();
  });

  it('throws when the caller scope is excluded', () => {
    expect(() => {
      assertMayUseHarness(
        { scopeNodeId: 'p2' },
        { policyScope: { projects: ['p1'] } },
      );
    }).toThrow(/not permitted/i);
  });

  it('allows when no policy scope is set (open)', () => {
    expect(() => {
      assertMayUseHarness({ scopeNodeId: 'p9' }, { policyScope: {} });
    }).not.toThrow();
  });
});
