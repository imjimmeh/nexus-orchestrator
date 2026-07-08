import { describe, it, expect, vi } from 'vitest';
import { WorkflowResolutionService } from './workflow-resolution.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

describe('WorkflowResolutionService.resolve', () => {
  it('delegates to ScopedConfigResolver with objectType=workflow', async () => {
    const fakeResult = {
      objectType: 'workflow',
      name: 'my-wf',
      scopeNodeId: 'proj-1',
      value: {},
      contributingLayers: [],
      isDefault: false,
      locked: false,
    };
    const resolver = { resolve: vi.fn().mockResolvedValue(fakeResult) } as any;
    const svc = new WorkflowResolutionService(resolver);

    const result = await svc.resolve('my-wf', 'proj-1');

    expect(resolver.resolve).toHaveBeenCalledWith(
      'workflow',
      'my-wf',
      'proj-1',
    );
    expect(result).toBe(fakeResult);
  });

  it('uses GLOBAL_SCOPE_NODE_ID when scopeNodeId is null', async () => {
    const resolver = { resolve: vi.fn().mockResolvedValue({}) } as any;
    const svc = new WorkflowResolutionService(resolver);
    await svc.resolve('my-wf', null);
    expect(resolver.resolve).toHaveBeenCalledWith(
      'workflow',
      'my-wf',
      GLOBAL_SCOPE_NODE_ID,
    );
  });
});
