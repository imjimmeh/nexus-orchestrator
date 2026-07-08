import { describe, it, expect, vi } from 'vitest';
import { AgentProfileResolutionService } from './services/agent-profile-resolution.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

describe('AgentProfile scope override resolution', () => {
  it('resolves project-scoped override over default', async () => {
    const effectiveResult = {
      objectType: 'agent_profile',
      name: 'assistant',
      scopeNodeId: 'project-1',
      value: {
        id: 'override-id',
        name: 'assistant',
        scope_node_id: 'project-1',
      },
      contributingLayers: [
        {
          rowId: 'default-id',
          scopeNodeId: null,
          source: 'seeded',
          strategy: 'replace',
        },
        {
          rowId: 'override-id',
          scopeNodeId: 'project-1',
          source: 'admin',
          strategy: 'replace',
        },
      ],
      isDefault: false,
      locked: false,
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(effectiveResult),
    } as any;
    const svc = new AgentProfileResolutionService(resolver);

    const result = await svc.resolve('assistant', 'project-1');

    expect(result.value).toMatchObject({ scope_node_id: 'project-1' });
    expect(result.isDefault).toBe(false);
    expect(result.contributingLayers).toHaveLength(2);
    expect(resolver.resolve).toHaveBeenCalledWith(
      'agent_profile',
      'assistant',
      'project-1',
    );
  });

  it('resolves platform default when no project override exists', async () => {
    const defaultResult = {
      objectType: 'agent_profile',
      name: 'assistant',
      scopeNodeId: 'other-project',
      value: { id: 'default-id', name: 'assistant', scope_node_id: null },
      contributingLayers: [
        {
          rowId: 'default-id',
          scopeNodeId: null,
          source: 'seeded',
          strategy: 'replace',
        },
      ],
      isDefault: true,
      locked: false,
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(defaultResult),
    } as any;
    const svc = new AgentProfileResolutionService(resolver);

    const result = await svc.resolve('assistant', 'other-project');

    expect(result.isDefault).toBe(true);
    expect(result.value).toMatchObject({ scope_node_id: null });
  });

  it('resolves at GLOBAL scope when null passed', async () => {
    const resolver = {
      resolve: vi.fn().mockResolvedValue({ isDefault: true, value: {} }),
    } as any;
    const svc = new AgentProfileResolutionService(resolver);
    await svc.resolve('assistant', null);
    expect(resolver.resolve).toHaveBeenCalledWith(
      'agent_profile',
      'assistant',
      GLOBAL_SCOPE_NODE_ID,
    );
  });
});
