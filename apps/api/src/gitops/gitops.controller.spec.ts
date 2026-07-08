import { RequestMethod } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { describe, it, expect, vi } from 'vitest';
import { GitOpsController } from './gitops.controller';

describe('GitOpsController', () => {
  function routeArgs(methodName: keyof GitOpsController) {
    return Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      GitOpsController,
      methodName,
    ) as Record<string, { index: number; data?: string; pipes?: unknown[] }>;
  }

  it('exposes item routes with scopeNodeId as a route param', () => {
    const getArgs = routeArgs('getBinding');
    const updateArgs = routeArgs('updateBinding');
    const deleteArgs = routeArgs('disableBinding');

    expect(
      Reflect.getMetadata(PATH_METADATA, GitOpsController.prototype.getBinding),
    ).toBe('bindings/:scopeNodeId/:bindingId');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        GitOpsController.prototype.getBinding,
      ),
    ).toBe(RequestMethod.GET);
    expect(Object.keys(getArgs)).toEqual(
      expect.arrayContaining(['5:0', '5:1']),
    );

    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.updateBinding,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        GitOpsController.prototype.updateBinding,
      ),
    ).toBe(RequestMethod.PATCH);
    expect(Object.keys(updateArgs)).toEqual(
      expect.arrayContaining(['5:0', '5:1', '3:2']),
    );

    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.disableBinding,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        GitOpsController.prototype.disableBinding,
      ),
    ).toBe(RequestMethod.DELETE);
    expect(Object.keys(deleteArgs)).toEqual(
      expect.arrayContaining(['5:0', '5:1']),
    );
  });

  function makeController() {
    const exporter = { exportToFiles: vi.fn().mockResolvedValue([]) } as any;
    const recon = {
      plan: vi.fn().mockResolvedValue({
        changes: [],
        summary: { create: 0, update: 0, delete: 0, noop: 0 },
      }),
      apply: vi.fn().mockResolvedValue({
        planned: 0,
        applied: 0,
        skipped: 0,
        dryRun: false,
      }),
      detectDrift: vi.fn().mockResolvedValue({ drifted: [], inSync: 0 }),
    } as any;
    const statusSvc = { getStatus: vi.fn() } as any;
    const config = { repoUrl: 'https://example.com/r.git', ref: 'main' } as any;
    const bindings = {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      disable: vi.fn(),
    } as any;
    const inbound = {
      validate: vi.fn(),
      plan: vi.fn(),
      apply: vi.fn(),
    } as any;
    const outbound = {
      sync: vi.fn(),
    } as any;
    const scopeAccess = {
      restrictToAccessibleScopes: vi
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _permission: string,
            requestedScopeId?: string,
          ) => (requestedScopeId ? [requestedScopeId] : []),
        ),
    } as any;
    return {
      controller: new GitOpsController(
        exporter,
        recon,
        statusSvc,
        config,
        bindings,
        inbound,
        outbound,
        scopeAccess,
      ),
      recon,
      bindings,
      inbound,
      outbound,
      scopeAccess,
    };
  }

  it('defaults to dry-run (plan) when dryRun is omitted', async () => {
    const { controller, recon } = makeController();
    await controller.reconcile({ user: { userId: 'admin' } }, {});
    expect(recon.plan).toHaveBeenCalled();
    expect(recon.apply).not.toHaveBeenCalled();
  });

  it('applies when dryRun is explicitly false', async () => {
    const { controller, recon } = makeController();
    await controller.reconcile(
      { user: { userId: 'admin' } },
      {
        dryRun: false,
      },
    );
    expect(recon.apply).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: 'https://example.com/r.git' }),
      { actorId: 'admin' },
    );
  });

  it('uses plan (not apply) when dryRun is explicitly true', async () => {
    const { controller, recon } = makeController();
    await controller.reconcile(
      { user: { userId: 'admin' } },
      {
        dryRun: true,
      },
    );
    expect(recon.plan).toHaveBeenCalled();
    expect(recon.apply).not.toHaveBeenCalled();
  });

  it('decorates the legacy POST /gitops/reconcile route with a Deprecation: true header', () => {
    const headers = Reflect.getMetadata(
      HEADERS_METADATA,
      GitOpsController.prototype.reconcile,
    ) as Array<{ name: string; value: string }> | undefined;
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Deprecation', value: 'true' }),
      ]),
    );
  });

  it('does not decorate the canonical binding-aware POST /gitops/bindings/:scopeNodeId/:bindingId/apply with a Deprecation header', () => {
    const headers = Reflect.getMetadata(
      HEADERS_METADATA,
      GitOpsController.prototype.applyBinding,
    ) as Array<{ name: string; value: string }> | undefined;
    const hasDeprecation = (headers ?? []).some(
      (header) => header.name.toLowerCase() === 'deprecation',
    );
    expect(hasDeprecation).toBe(false);
  });

  it('GET /gitops/drift returns the drift report wrapped in envelope', async () => {
    const { controller } = makeController();
    const res = await controller.drift({ user: { userId: 'admin' } });
    expect(res).toEqual({ success: true, data: { drifted: [], inSync: 0 } });
  });

  it('GET /gitops/bindings returns bindings for an accessible scope node', async () => {
    const { controller, bindings, scopeAccess } = makeController();
    bindings.list.mockResolvedValue([{ id: 'binding-1' }]);

    const res = await controller.listBindings(
      { scopeNodeId: 'scope-1' },
      { user: { userId: 'user-1' } },
    );

    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'user-1',
      'gitops:read',
      'scope-1',
    );
    expect(bindings.list).toHaveBeenCalledWith('scope-1');
    expect(res).toEqual({ success: true, data: [{ id: 'binding-1' }] });
  });

  it('GET /gitops/bindings default-denies an out-of-subtree scope node', async () => {
    const { controller, bindings, scopeAccess } = makeController();
    scopeAccess.restrictToAccessibleScopes.mockResolvedValue([]);

    const res = await controller.listBindings(
      { scopeNodeId: 'scope-out-of-subtree' },
      { user: { userId: 'user-1' } },
    );

    expect(bindings.list).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true, data: [] });
  });

  it('POST /gitops/bindings delegates to the binding service', async () => {
    const { controller, bindings } = makeController();
    bindings.create.mockResolvedValue({ id: 'binding-1' });

    const res = await controller.createBinding({
      scopeNodeId: 'scope-1',
      name: 'primary',
      repoUrl: 'https://example.com/repo.git',
      defaultRef: 'main',
      rootPath: '.',
      syncMode: 'git_to_app',
      includedObjectTypes: ['scope_node'],
    });

    expect(bindings.create).toHaveBeenCalledWith({
      scopeNodeId: 'scope-1',
      name: 'primary',
      repoUrl: 'https://example.com/repo.git',
      defaultRef: 'main',
      rootPath: '.',
      syncMode: 'git_to_app',
      includedObjectTypes: ['scope_node'],
    });
    expect(res).toEqual({ success: true, data: { id: 'binding-1' } });
  });

  it('GET /gitops/bindings/:bindingId returns a binding', async () => {
    const { controller, bindings } = makeController();
    bindings.get.mockResolvedValue({ id: 'binding-1' });

    const res = await (controller as any).getBinding('scope-1', 'binding-1');

    expect(bindings.get).toHaveBeenCalledWith('binding-1', 'scope-1');
    expect(res).toEqual({ success: true, data: { id: 'binding-1' } });
  });

  it('PATCH /gitops/bindings/:bindingId updates a binding', async () => {
    const { controller, bindings } = makeController();
    bindings.update.mockResolvedValue({ id: 'binding-1', syncMode: 'two_way' });

    const res = await (controller as any).updateBinding(
      'scope-1',
      'binding-1',
      {
        syncMode: 'two_way',
      },
    );

    expect(bindings.update).toHaveBeenCalledWith('binding-1', 'scope-1', {
      syncMode: 'two_way',
    });
    expect(res).toEqual({
      success: true,
      data: { id: 'binding-1', syncMode: 'two_way' },
    });
  });

  it('DELETE /gitops/bindings/:bindingId disables a binding', async () => {
    const { controller, bindings } = makeController();
    bindings.disable.mockResolvedValue({ id: 'binding-1', enabled: false });

    const res = await (controller as any).disableBinding(
      'scope-1',
      'binding-1',
    );

    expect(bindings.disable).toHaveBeenCalledWith('binding-1', 'scope-1');
    expect(res).toEqual({
      success: true,
      data: { id: 'binding-1', enabled: false },
    });
  });

  it('routes binding validation, plan, and apply through scope-aware params', async () => {
    const { controller, inbound } = makeController();
    inbound.validate.mockResolvedValue({
      bindingId: 'binding-1',
      objectCount: 1,
    });
    inbound.plan.mockResolvedValue({
      changes: [],
      summary: { create: 0, update: 0, delete: 0, noop: 0 },
    });
    inbound.apply.mockResolvedValue({
      planned: 0,
      applied: 0,
      skipped: 0,
      dryRun: false,
    });

    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.validateBinding,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId/validate');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.planBinding,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId/plan');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.applyBinding,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId/apply');

    await controller.validateBinding(
      { user: { userId: 'user-1' } },
      'scope-1',
      'binding-1',
    );
    await controller.planBinding(
      { user: { userId: 'user-1' } },
      'scope-1',
      'binding-1',
    );
    await controller.applyBinding(
      { user: { userId: 'user-1' } },
      'scope-1',
      'binding-1',
    );

    expect(inbound.validate).toHaveBeenCalledWith('scope-1', 'binding-1', {
      actorId: 'user-1',
    });
    expect(inbound.plan).toHaveBeenCalledWith('scope-1', 'binding-1', {
      actorId: 'user-1',
    });
    expect(inbound.apply).toHaveBeenCalledWith('scope-1', 'binding-1', {
      actorId: 'user-1',
    });
  });

  it('routes outbound sync through scope-aware params', async () => {
    const { controller, outbound } = makeController();
    outbound.sync.mockResolvedValue({
      bindingId: 'binding-1',
      branchName: 'gitops/binding-1/1',
      pendingChangeCount: 1,
    });

    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GitOpsController.prototype.syncBindingOutbound,
      ),
    ).toBe('bindings/:scopeNodeId/:bindingId/outbound-sync');

    const result = await controller.syncBindingOutbound(
      { user: { userId: 'user-1' } },
      'scope-1',
      'binding-1',
    );

    expect(outbound.sync).toHaveBeenCalledWith('scope-1', 'binding-1', {
      actorId: 'user-1',
    });
    expect(result).toEqual({
      success: true,
      data: {
        bindingId: 'binding-1',
        branchName: 'gitops/binding-1/1',
        pendingChangeCount: 1,
      },
    });
  });
});
