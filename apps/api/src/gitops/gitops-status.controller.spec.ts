import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitOpsController } from './gitops.controller';
import { GitOpsStatusService } from './gitops-status.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { GitOpsOutboundSyncService } from './gitops-outbound-sync.service';
import { ConfigExportService } from './config-export.service';
import { ReconciliationService } from './reconciliation.service';
import { GITOPS_CONFIG } from './gitops.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';

const status = {
  bindings: [
    {
      bindingId: 'binding-1',
      name: 'primary',
      scopeNodeId: 'org-1',
      syncMode: 'git_to_app',
      enabled: true,
      lastAppliedRevision: 'rev-1',
      latestRun: {
        id: 'run-1',
        bindingId: 'binding-1',
        direction: 'git_to_app',
        status: 'success',
        revision: 'rev-1',
        summary: '{"create":0,"update":2,"prune":0,"drift":1}',
        finishedAt: '2026-06-08T00:00:00.000Z',
      },
      pendingChangeCount: 1,
      driftCount: 1,
    },
  ],
  lastReconcile: {
    id: 'rec-1',
    finishedAt: '2026-06-08T00:00:00.000Z',
    result: 'success',
    summary: { create: 0, update: 2, prune: 0, drift: 1 },
    dryRun: false,
    auditEventId: 'aud-1',
  },
  drift: [
    {
      kind: 'workflow',
      name: 'pr-review',
      scopeNodeId: 'org-1',
      managedBy: 'gitops',
      driftedFields: ['description'],
      auditEventId: 'aud-2',
    },
  ],
  managedByCounts: { gitops: 12, manual: 3, seed: 5 },
};

describe('GitOpsController GET /gitops/status', () => {
  let controller: GitOpsController;
  const svc = { getStatus: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [GitOpsController],
      providers: [
        { provide: GitOpsStatusService, useValue: svc },
        {
          provide: GitOpsRepositoryBindingService,
          useValue: { list: vi.fn() },
        },
        {
          provide: GitOpsInboundReconcileService,
          useValue: { validate: vi.fn(), plan: vi.fn(), apply: vi.fn() },
        },
        {
          provide: GitOpsOutboundSyncService,
          useValue: { sync: vi.fn() },
        },
        { provide: ConfigExportService, useValue: { exportToFiles: vi.fn() } },
        {
          provide: ReconciliationService,
          useValue: { plan: vi.fn(), apply: vi.fn(), detectDrift: vi.fn() },
        },
        {
          provide: GITOPS_CONFIG,
          useValue: {
            enabled: false,
            repoUrl: '',
            ref: 'main',
            intervalMs: 300000,
          },
        },
        {
          provide: ScopeAccessService,
          useValue: { restrictToAccessibleScopes: vi.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(GitOpsController);
  });

  it('returns last reconcile, drift and managed-by counts wrapped in envelope', async () => {
    svc.getStatus.mockReturnValue(status);
    await expect(controller.getStatus()).resolves.toEqual({
      success: true,
      data: status,
    });
    expect(svc.getStatus).toHaveBeenCalledOnce();
  });

  it('returns a null lastReconcile when nothing has run', async () => {
    const emptyStatus = {
      bindings: [],
      lastReconcile: null,
      drift: [],
      managedByCounts: { gitops: 0, manual: 0, seed: 0 },
    };
    svc.getStatus.mockReturnValue(emptyStatus);
    await expect(controller.getStatus()).resolves.toEqual({
      success: true,
      data: emptyStatus,
    });
  });
});
