import { describe, expect, it } from 'vitest';
import { IntegrationStrategyResolver } from './integration-strategy.resolver';
import * as integrationBarrel from './index';

describe('IntegrationStrategyResolver', () => {
  const resolver = new IntegrationStrategyResolver();

  it('defaults to direct-push when input is undefined', () => {
    expect(resolver.resolve(undefined)).toEqual({
      strategy: 'direct-push',
      mergeMethod: 'merge',
      autoMerge: false,
      preflightGate: true,
    });
  });

  it('defaults to direct-push when input is an empty object', () => {
    expect(resolver.resolve({})).toEqual({
      strategy: 'direct-push',
      mergeMethod: 'merge',
      autoMerge: false,
      preflightGate: true,
    });
  });

  it('reads the four neutral keys when valid', () => {
    expect(
      resolver.resolve({
        integration_strategy: 'pull-request',
        integration_merge_method: 'squash',
        integration_auto_merge: true,
        integration_preflight_gate: false,
      }),
    ).toEqual({
      strategy: 'pull-request',
      mergeMethod: 'squash',
      autoMerge: true,
      preflightGate: false,
    });
  });

  it('falls back to defaults on unknown enum values without throwing', () => {
    expect(
      resolver.resolve({
        integration_strategy: 'rocket-launch',
        integration_merge_method: 'cherry-pick',
      }),
    ).toEqual({
      strategy: 'direct-push',
      mergeMethod: 'merge',
      autoMerge: false,
      preflightGate: true,
    });
  });

  it('coerces string booleans from trigger templating ("true"/"false")', () => {
    expect(
      resolver.resolve({
        integration_auto_merge: 'true',
        integration_preflight_gate: 'false',
      }),
    ).toMatchObject({ autoMerge: true, preflightGate: false });
  });

  it('never throws on garbage input', () => {
    expect(() =>
      resolver.resolve({
        integration_strategy: 42,
        integration_merge_method: null,
        integration_auto_merge: {},
        integration_preflight_gate: [],
      }),
    ).not.toThrow();
    expect(resolver.resolve({ integration_strategy: 42 }).strategy).toBe(
      'direct-push',
    );
  });
});

describe('integration barrel', () => {
  it('re-exports the resolver and the merge-provider token', () => {
    expect(integrationBarrel.IntegrationStrategyResolver).toBeDefined();
    expect(integrationBarrel.MERGE_PROVIDER.toString()).toBe(
      'Symbol(MERGE_PROVIDER)',
    );
  });
});
