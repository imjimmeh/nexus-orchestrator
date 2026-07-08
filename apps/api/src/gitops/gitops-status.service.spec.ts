import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import { GitOpsReconcileRunRepository } from './database/repositories/gitops-reconcile-run.repository';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import { GitOpsStatusService } from './gitops-status.service';

describe('GitOpsStatusService', () => {
  const bindingRepository = {
    findAll: vi.fn(),
  };

  const reconcileRunRepository = {
    findAll: vi.fn(),
  };

  const pendingChangeRepository = {
    findAll: vi.fn(),
  };

  let service: GitOpsStatusService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        GitOpsStatusService,
        {
          provide: GitOpsRepositoryBindingRepository,
          useValue: bindingRepository,
        },
        {
          provide: GitOpsReconcileRunRepository,
          useValue: reconcileRunRepository,
        },
        {
          provide: GitOpsPendingChangeRepository,
          useValue: pendingChangeRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(GitOpsStatusService);
  });

  it('ignores completed pending changes when counting drift and pending work', async () => {
    bindingRepository.findAll.mockResolvedValue([
      {
        id: 'binding-1',
        scopeNodeId: 'scope-1',
        name: 'primary',
        syncMode: 'git_to_app',
        enabled: true,
        lastAppliedRevision: 'rev-10',
      },
      {
        id: 'binding-2',
        scopeNodeId: 'scope-2',
        name: 'secondary',
        syncMode: 'two_way',
        enabled: false,
        lastAppliedRevision: null,
      },
    ]);

    reconcileRunRepository.findAll.mockResolvedValue([
      {
        id: 'run-2',
        bindingId: 'binding-1',
        direction: 'git_to_app',
        status: 'success',
        revision: 'rev-10',
        summary: '{"create":0,"update":2,"prune":0,"drift":1}',
        finishedAt: new Date('2026-06-11T11:00:00.000Z'),
      },
      {
        id: 'run-1',
        bindingId: 'binding-2',
        direction: 'two_way',
        status: 'failure',
        revision: 'rev-9',
        summary: '{"create":1,"update":0,"prune":0,"drift":0}',
        finishedAt: new Date('2026-06-10T11:00:00.000Z'),
      },
    ]);

    pendingChangeRepository.findAll.mockResolvedValue([
      {
        id: 'change-1',
        bindingId: 'binding-1',
        objectType: 'workflow',
        objectKey: 'pr-review',
        scopeNodeId: 'scope-1',
        changeType: 'drift',
        status: 'pending',
      },
      {
        id: 'change-2',
        bindingId: 'binding-1',
        objectType: 'role',
        objectKey: 'editor',
        scopeNodeId: 'scope-1',
        changeType: 'update',
        status: 'completed',
      },
    ]);

    const result = await service.getStatus();

    expect(bindingRepository.findAll).toHaveBeenCalledOnce();
    expect(reconcileRunRepository.findAll).toHaveBeenCalledOnce();
    expect(pendingChangeRepository.findAll).toHaveBeenCalledOnce();
    expect(result).toEqual({
      bindings: [
        {
          bindingId: 'binding-1',
          name: 'primary',
          scopeNodeId: 'scope-1',
          syncMode: 'git_to_app',
          enabled: true,
          lastAppliedRevision: 'rev-10',
          latestRun: {
            id: 'run-2',
            bindingId: 'binding-1',
            direction: 'git_to_app',
            status: 'success',
            revision: 'rev-10',
            summary: '{"create":0,"update":2,"prune":0,"drift":1}',
            finishedAt: '2026-06-11T11:00:00.000Z',
          },
          pendingChangeCount: 1,
          driftCount: 1,
        },
        {
          bindingId: 'binding-2',
          name: 'secondary',
          scopeNodeId: 'scope-2',
          syncMode: 'two_way',
          enabled: false,
          lastAppliedRevision: null,
          latestRun: {
            id: 'run-1',
            bindingId: 'binding-2',
            direction: 'two_way',
            status: 'failure',
            revision: 'rev-9',
            summary: '{"create":1,"update":0,"prune":0,"drift":0}',
            finishedAt: '2026-06-10T11:00:00.000Z',
          },
          pendingChangeCount: 0,
          driftCount: 0,
        },
      ],
      lastReconcile: {
        id: 'run-2',
        finishedAt: '2026-06-11T11:00:00.000Z',
        result: 'success',
        summary: { create: 0, update: 2, prune: 0, drift: 1 },
        dryRun: false,
        auditEventId: 'run-2',
      },
      drift: [
        {
          kind: 'workflow',
          name: 'pr-review',
          scopeNodeId: 'scope-1',
          managedBy: 'gitops',
          driftedFields: ['drift'],
          auditEventId: 'change-1',
        },
      ],
      managedByCounts: { gitops: 2, manual: 0, seed: 0 },
    });
  });

  it('uses the most recently finished run for the top-level reconcile summary', async () => {
    bindingRepository.findAll.mockResolvedValue([
      {
        id: 'binding-1',
        scopeNodeId: 'scope-1',
        name: 'primary',
        syncMode: 'git_to_app',
        enabled: true,
        lastAppliedRevision: 'rev-10',
      },
    ]);

    reconcileRunRepository.findAll.mockResolvedValue([
      {
        id: 'run-created-later-finished-earlier',
        bindingId: 'binding-1',
        direction: 'git_to_app',
        status: 'success',
        revision: 'rev-older',
        summary: '{"create":1,"update":0,"prune":0,"drift":0}',
        createdAt: new Date('2026-06-12T09:00:00.000Z'),
        finishedAt: new Date('2026-06-12T09:30:00.000Z'),
      },
      {
        id: 'run-created-earlier-finished-later',
        bindingId: 'binding-1',
        direction: 'git_to_app',
        status: 'failure',
        revision: 'rev-newer',
        summary: '{"create":0,"update":1,"prune":0,"drift":2}',
        createdAt: new Date('2026-06-12T08:00:00.000Z'),
        finishedAt: new Date('2026-06-12T10:00:00.000Z'),
      },
    ]);

    pendingChangeRepository.findAll.mockResolvedValue([]);

    const result = await service.getStatus();

    expect(result.lastReconcile).toEqual({
      id: 'run-created-earlier-finished-later',
      finishedAt: '2026-06-12T10:00:00.000Z',
      result: 'failure',
      summary: { create: 0, update: 1, prune: 0, drift: 2 },
      dryRun: false,
      auditEventId: 'run-created-earlier-finished-later',
    });
  });
});
