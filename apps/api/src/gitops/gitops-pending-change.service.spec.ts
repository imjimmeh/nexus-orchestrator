import { describe, expect, it, vi } from 'vitest';
import { GitOpsPendingChangeService } from './gitops-pending-change.service';
import type { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import type { ScopeService } from '../scope/scope.service';

describe('GitOpsPendingChangeService', () => {
  it('creates a pending outbound change with the binding revision as base', async () => {
    const { service, pending } = createService({ existing: null });

    await service.recordConfigObjectChange({
      binding: bindingFixture(),
      objectType: 'workflow',
      scopeNodeId: 'scope-1',
      name: 'deploy',
      changeType: 'update',
      payload: { yamlDefinition: 'name: deploy' },
      actorId: 'user-1',
    });

    expect(pending.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-1',
        objectType: 'workflow',
        objectKey: '/acme:deploy',
        scopeNodeId: 'scope-1',
        changeType: 'update',
        payload: { yamlDefinition: 'name: deploy' },
        baseRevision: 'rev-1',
        status: 'pending',
        createdByUserId: 'user-1',
      }),
    );
  });

  it('updates an existing pending outbound change instead of duplicating it', async () => {
    const { service, pending } = createService({
      existing: { id: 'pending-1' },
    });

    await service.recordConfigObjectChange({
      binding: bindingFixture(),
      objectType: 'agent_profile',
      scopeNodeId: 'scope-1',
      name: 'reviewer',
      changeType: 'update',
      payload: { systemPrompt: 'new' },
      actorId: 'user-1',
    });

    expect(pending.create).not.toHaveBeenCalled();
    expect(pending.update).toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({
        changeType: 'update',
        payload: { systemPrompt: 'new' },
        baseRevision: 'rev-1',
        status: 'pending',
      }),
    );
  });
});

function bindingFixture() {
  return {
    id: 'binding-1',
    scopeNodeId: 'scope-1',
    syncMode: 'two_way' as const,
    lastAppliedRevision: 'rev-1',
  };
}

function createService(params: { existing: unknown }) {
  const pending = {
    findActiveByObject: vi.fn().mockResolvedValue(params.existing),
    create: vi.fn().mockResolvedValue({ id: 'pending-1' }),
    update: vi.fn().mockResolvedValue({ id: 'pending-1' }),
  };
  const scope = {
    getTree: vi.fn().mockResolvedValue({
      id: 'root',
      slug: '',
      children: [{ id: 'scope-1', slug: 'acme', children: [] }],
    }),
  };

  return {
    service: new GitOpsPendingChangeService(
      pending as unknown as GitOpsPendingChangeRepository,
      scope as unknown as ScopeService,
    ),
    pending,
  };
}
