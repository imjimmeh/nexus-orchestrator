import { describe, it, expect, vi } from 'vitest';
import { buildInitialStateVariables } from './workflow-initial-state.util';
import type { VariableResolverService } from '../variables/variable-resolver.service';

describe('buildInitialStateVariables', () => {
  it('snapshots resolved vars under the vars namespace', async () => {
    const resolver = {
      resolveContext: vi
        .fn()
        .mockResolvedValue({ gates: { rediscovery_merge_threshold: 10 } }),
    } as unknown as VariableResolverService;

    const state = await buildInitialStateVariables(
      { scopeId: 'project-1', foo: 'bar' },
      resolver,
    );

    expect(resolver.resolveContext).toHaveBeenCalledWith('project-1');
    expect(state).toEqual({
      trigger: { scopeId: 'project-1', foo: 'bar' },
      vars: { gates: { rediscovery_merge_threshold: 10 } },
    });
  });

  it('resolves only global vars when trigger has no scopeId', async () => {
    const resolver = {
      resolveContext: vi.fn().mockResolvedValue({}),
    } as unknown as VariableResolverService;

    const state = await buildInitialStateVariables({ foo: 'bar' }, resolver);

    expect(resolver.resolveContext).toHaveBeenCalledWith(null);
    expect(state.vars).toEqual({});
  });
});
