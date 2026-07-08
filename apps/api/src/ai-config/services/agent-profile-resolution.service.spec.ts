import { describe, it, expect, vi } from 'vitest';
import { AgentProfileResolutionService } from './agent-profile-resolution.service';

describe('AgentProfileResolutionService.resolve', () => {
  it('delegates to ScopedConfigResolver with objectType=agent_profile', async () => {
    const fakeResult = {
      objectType: 'agent_profile',
      name: 'assistant',
      scopeNodeId: 'project-1',
      value: { id: 'override-id', name: 'assistant' },
      contributingLayers: [],
      isDefault: false,
      locked: false,
    };
    const resolver = { resolve: vi.fn().mockResolvedValue(fakeResult) } as any;
    const svc = new AgentProfileResolutionService(resolver);

    const result = await svc.resolve('assistant', 'project-1');

    expect(resolver.resolve).toHaveBeenCalledWith(
      'agent_profile',
      'assistant',
      'project-1',
    );
    expect(result).toBe(fakeResult);
  });

  it('uses GLOBAL_SCOPE_NODE_ID when scopeNodeId is null', async () => {
    const resolver = { resolve: vi.fn().mockResolvedValue({}) } as any;
    const svc = new AgentProfileResolutionService(resolver);

    await svc.resolve('assistant', null);

    expect(resolver.resolve).toHaveBeenCalledWith(
      'agent_profile',
      'assistant',
      '00000000-0000-0000-0000-000000000000',
    );
  });
});
