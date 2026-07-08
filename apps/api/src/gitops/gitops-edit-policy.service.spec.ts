import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GitOpsEditPolicyService } from './gitops-edit-policy.service';
import type { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';

const twoWayBinding = {
  id: 'binding-1',
  scopeNodeId: 'scope-1',
  syncMode: 'two_way' as const,
  enabled: true,
  includedObjectTypes: ['workflow', 'agent_profile', 'skill'],
  lastAppliedRevision: 'rev-1',
};

const gitToAppBinding = {
  ...twoWayBinding,
  id: 'binding-2',
  syncMode: 'git_to_app' as const,
};

describe('GitOpsEditPolicyService', () => {
  it('allows unmanaged objects to be edited normally', async () => {
    const service = createService({ binding: null });

    const decision = await service.evaluateExisting({
      objectType: 'workflow',
      managedBy: 'manual',
      managedBindingId: null,
      locked: false,
    });

    expect(decision.action).toBe('allow');
  });

  it('blocks normal edits to git-to-app managed objects', async () => {
    const service = createService({ binding: gitToAppBinding });

    const decision = await service.evaluateExisting({
      objectType: 'workflow',
      managedBy: 'gitops',
      managedBindingId: gitToAppBinding.id,
      locked: false,
    });

    expect(decision.action).toBe('block');
    expect(decision.reason).toContain('git-to-app');
  });

  it('allows two-way managed objects and requires a pending outbound change', async () => {
    const service = createService({ binding: twoWayBinding });

    const decision = await service.evaluateExisting({
      objectType: 'agent_profile',
      managedBy: 'gitops',
      managedBindingId: twoWayBinding.id,
      locked: false,
    });

    expect(decision.action).toBe('allow_with_pending_change');
    expect(decision.binding).toMatchObject({ id: twoWayBinding.id });
  });

  it('blocks edits to locked GitOps-managed objects', async () => {
    const service = createService({ binding: twoWayBinding });

    const decision = await service.evaluateExisting({
      objectType: 'skill',
      managedBy: 'gitops',
      managedBindingId: twoWayBinding.id,
      locked: true,
    });

    expect(() => {
      service.assertAllowed(decision);
    }).toThrow(BadRequestException);
  });

  it('allows new syncable objects in a two-way bound scope with pending change tracking', async () => {
    const service = createService({ binding: twoWayBinding });

    const decision = await service.evaluateCreate({
      objectType: 'skill',
      scopeNodeId: 'scope-1',
    });

    expect(decision.action).toBe('allow_with_pending_change');
    expect(decision.binding).toMatchObject({ id: twoWayBinding.id });
  });
});

function createService(params: { binding: unknown }) {
  const bindings = {
    findById: vi.fn().mockResolvedValue(params.binding),
    findByScopeNodeId: vi
      .fn()
      .mockResolvedValue(params.binding ? [params.binding] : []),
  } as unknown as GitOpsRepositoryBindingRepository;

  return new GitOpsEditPolicyService(bindings);
}
