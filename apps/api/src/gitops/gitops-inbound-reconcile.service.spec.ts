import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import type { GitOpsObjectHandler } from './objects/gitops-object-handler.types';
import { GITOPS_MANAGED_BY } from './gitops.constants';

const binding = {
  id: 'binding-1',
  scopeNodeId: 'scope-1',
  defaultRef: 'main',
  enabled: true,
  syncMode: 'two_way',
  includedObjectTypes: ['workflow'],
  conflictPolicy: 'require_review',
  lastAppliedRevision: 'rev-1',
} as GitOpsRepositoryBinding;

describe('GitOpsInboundReconcileService', () => {
  let bindingRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let desiredState: { loadForBinding: ReturnType<typeof vi.fn> };
  let registry: { getHandlersForBinding: ReturnType<typeof vi.fn> };
  let diff: { computePlan: ReturnType<typeof vi.fn> };
  let applier: { apply: ReturnType<typeof vi.fn> };
  let runRepo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let pendingRepo: { findByBindingId: ReturnType<typeof vi.fn> };
  let handler: GitOpsObjectHandler;
  let service: GitOpsInboundReconcileService;

  beforeEach(() => {
    bindingRepo = {
      findById: vi.fn().mockResolvedValue(binding),
      update: vi
        .fn()
        .mockResolvedValue({ ...binding, lastAppliedRevision: 'main' }),
    };
    desiredState = {
      loadForBinding: vi.fn().mockResolvedValue({
        prune: false,
        objects: [
          {
            type: 'workflow',
            key: '/scope:build',
            fields: { name: 'build', scope: '/scope' },
          },
        ],
      }),
    };
    handler = {
      objectType: 'workflow',
      readActual: vi.fn().mockResolvedValue([
        {
          objectType: 'workflow',
          key: '/scope:build',
          fields: { name: 'build', scope: '/scope', version: 1 },
          managedBy: GITOPS_MANAGED_BY,
          locked: false,
        },
      ]),
      normalizeDesired: vi.fn((input) => ({
        objectType: input.objectType,
        key: input.key,
        fields: input.fields,
      })),
      plan: vi.fn(),
      apply: vi.fn(),
      serialize: vi.fn(),
      canEdit: vi.fn(),
    };
    registry = { getHandlersForBinding: vi.fn().mockReturnValue([handler]) };
    diff = {
      computePlan: vi.fn().mockReturnValue({
        changes: [
          {
            type: 'workflow',
            key: '/scope:build',
            op: 'update',
            diff: { version: { from: 1, to: 2 } },
          },
        ],
        summary: { create: 0, update: 1, delete: 0, noop: 0 },
      }),
    };
    applier = {
      apply: vi.fn().mockResolvedValue({
        planned: 1,
        applied: 1,
        skipped: 0,
        dryRun: false,
      }),
    };
    runRepo = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({ id: 'run-1' }),
    };
    pendingRepo = { findByBindingId: vi.fn().mockResolvedValue([]) };
    service = new GitOpsInboundReconcileService(
      bindingRepo as any,
      desiredState as any,
      registry as any,
      diff as any,
      applier as any,
      runRepo as any,
      pendingRepo as any,
    );
  });

  it('plans a binding-scoped inbound reconcile through object handlers', async () => {
    const plan = await service.plan('scope-1', 'binding-1', {
      actorId: 'user-1',
    });

    expect(desiredState.loadForBinding).toHaveBeenCalledWith('binding-1', {
      actorId: 'user-1',
    });
    expect(handler.readActual).toHaveBeenCalledWith('scope-1');
    expect(diff.computePlan).toHaveBeenCalledWith(
      {
        prune: false,
        objects: [
          {
            type: 'workflow',
            key: '/scope:build',
            fields: { name: 'build', scope: '/scope' },
          },
        ],
      },
      expect.objectContaining({ objects: expect.any(Array) }),
      { pendingChanges: [], lastAppliedRevision: 'rev-1' },
    );
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-1',
        direction: 'inbound',
        status: 'planned',
        actorUserId: 'user-1',
      }),
    );
    expect(plan.summary.update).toBe(1);
  });

  it('applies a fresh plan and records completion', async () => {
    const result = await service.apply('scope-1', 'binding-1', {
      actorId: 'user-1',
    });

    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applying' }),
    );
    expect(applier.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: { create: 0, update: 1, delete: 0, noop: 0 },
      }),
      expect.objectContaining({ actorId: 'user-1', bindingId: 'binding-1' }),
    );
    expect(bindingRepo.update).toHaveBeenCalledWith('binding-1', {
      lastAppliedRevision: 'main',
    });
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'applied',
        finishedAt: expect.any(Date),
      }),
    );
    expect(result.applied).toBe(1);
  });

  it('aborts apply when the plan has conflicts', async () => {
    diff.computePlan.mockReturnValue({
      changes: [
        {
          type: 'workflow',
          key: '/scope:build',
          op: 'noop',
          conflict: true,
          skippedReason: 'pending outbound change requires review',
        },
      ],
      summary: { create: 0, update: 0, delete: 0, noop: 1 },
    });

    await expect(
      service.apply('scope-1', 'binding-1', { actorId: 'user-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(applier.apply).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('rejects bindings outside the requested scope', async () => {
    await expect(
      service.plan('other-scope', 'binding-1', { actorId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
