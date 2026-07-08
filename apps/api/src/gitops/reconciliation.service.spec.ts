import { describe, it, expect, vi } from 'vitest';
import { ReconciliationService } from './reconciliation.service';
import type { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import type { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import type { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';

describe('ReconciliationService (deprecated adapter)', () => {
  function wire() {
    const loader = {
      load: vi.fn().mockResolvedValue({
        prune: false,
        objects: [{ type: 'role', key: 'viewer', fields: {} }],
      }),
    };
    const reader = { read: vi.fn().mockResolvedValue({ objects: [] }) };
    const diff = {
      computePlan: vi.fn().mockReturnValue({
        changes: [{ type: 'role', key: 'viewer', op: 'create' }],
        summary: { create: 1, update: 0, delete: 0, noop: 0 },
      }),
    };
    const apply = {
      apply: vi.fn().mockResolvedValue({
        planned: 1,
        applied: 1,
        skipped: 0,
        dryRun: false,
      }),
    };
    const drift = {
      classify: vi.fn().mockReturnValue({ drifted: [], inSync: 1 }),
    };
    const inbound = { apply: vi.fn().mockResolvedValue(undefined) };
    const bindings = { listActive: vi.fn() };
    const emitDeprecatedApplyEvent = vi.fn().mockResolvedValue(undefined);
    const loopService: Pick<
      GitOpsReconciliationLoopService,
      'emitDeprecatedApplyEvent'
    > = {
      emitDeprecatedApplyEvent,
    };

    const svc = new ReconciliationService(
      loader as any,
      reader as any,
      diff as any,
      apply as any,
      drift,
      inbound as unknown as GitOpsInboundReconcileService,
      bindings as unknown as GitOpsRepositoryBindingService,
      loopService,
    );

    return {
      svc,
      loader,
      reader,
      diff,
      apply,
      drift,
      inbound,
      bindings,
      emitDeprecatedApplyEvent,
    };
  }

  const repo = { repoUrl: 'https://example.com/r.git', ref: 'main' };

  it('plan() is read-only: loads, reads, diffs, never applies', async () => {
    const { svc, apply } = wire();
    const result = await svc.plan(repo, { actorId: 'admin' });
    expect(result.summary.create).toBe(1);
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('apply() emits deprecated_apply and delegates to inbound.apply for each binding', async () => {
    const { svc, inbound, bindings, emitDeprecatedApplyEvent } = wire();
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
    ]);

    await svc.apply(repo, { actorId: 'admin' });

    expect(emitDeprecatedApplyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-1',
        reason: expect.stringContaining('legacy POST /gitops/reconcile'),
      }),
    );
    expect(inbound.apply).toHaveBeenCalledWith('scope-1', 'binding-1', {
      actorId: 'admin',
    });
  });

  it('apply() emits deprecated_apply with null bindingId when multiple bindings are active', async () => {
    const { svc, inbound, bindings, emitDeprecatedApplyEvent } = wire();
    bindings.listActive.mockResolvedValue([
      { id: 'binding-1', scopeNodeId: 'scope-1', enabled: true },
      { id: 'binding-2', scopeNodeId: 'scope-2', enabled: true },
    ]);

    await svc.apply(repo, { actorId: 'admin' });

    expect(emitDeprecatedApplyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: null }),
    );
    expect(inbound.apply).toHaveBeenCalledTimes(2);
  });

  it('apply() returns a zero-counts envelope when no bindings are active', async () => {
    const { svc, inbound, bindings, emitDeprecatedApplyEvent } = wire();
    bindings.listActive.mockResolvedValue([]);

    const result = await svc.apply(repo, { actorId: 'admin' });

    expect(result).toEqual({
      planned: 0,
      applied: 0,
      skipped: 0,
      dryRun: false,
    });
    expect(inbound.apply).not.toHaveBeenCalled();
    expect(emitDeprecatedApplyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: null }),
    );
  });

  it('passes desired keys to the reader for foreign-descendant detection', async () => {
    const { svc, reader } = wire();
    await svc.plan(repo, { actorId: 'admin' });
    expect(reader.read).toHaveBeenCalledWith(expect.any(Set));
  });

  it('detectDrift() returns a DriftReport without applying', async () => {
    const { svc, apply, drift } = wire();
    const report = await svc.detectDrift(repo, { actorId: 'admin' });
    expect(apply.apply).not.toHaveBeenCalled();
    expect(drift.classify).toHaveBeenCalled();
    expect(report).toEqual({ drifted: [], inSync: 1 });
  });
});
