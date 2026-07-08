import { describe, it, expect, vi } from 'vitest';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import type { ReconciliationPlan } from './reconciliation.types';

describe('ReconciliationApplyService.apply', () => {
  function makeService() {
    const manager = { query: vi.fn().mockResolvedValue([]) };
    const dataSource = {
      transaction: vi.fn(async (cb: any) => cb(manager)),
    } as any;
    const audit = { log: vi.fn().mockResolvedValue({}) } as any;
    const scope = {
      createNode: vi.fn().mockResolvedValue({ id: 'new-node-id' }),
    } as any;
    const registry = {
      getHandler: vi.fn(),
    } as any;
    return {
      svc: new ReconciliationApplyService(dataSource, audit, scope, registry),
      manager,
      audit,
      scope,
      registry,
      dataSource,
    };
  }

  const plan: ReconciliationPlan = {
    changes: [
      { type: 'scope_node', key: '/acme', op: 'create', diff: undefined },
      {
        type: 'role',
        key: 'member',
        op: 'update',
        diff: { description: { from: 'v1', to: 'v2' } },
      },
      { type: 'scope_node', key: '/stale', op: 'delete' },
      { type: 'role', key: 'viewer', op: 'noop' },
    ],
    summary: { create: 1, update: 1, delete: 1, noop: 1 },
  };

  it('applies every non-noop change inside one transaction', async () => {
    const { svc, dataSource, scope } = makeService();
    const result = await svc.apply(plan, {
      actorId: 'admin',
      desiredObjects: new Map(),
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(scope.createNode).toHaveBeenCalled();
    expect(result.applied).toBe(3);
    expect(result.skipped).toBe(1);
  });

  it('writes an audit row per applied change', async () => {
    const { svc, audit } = makeService();
    await svc.apply(plan, { actorId: 'admin', desiredObjects: new Map() });
    expect(audit.log).toHaveBeenCalledTimes(3);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'GitOpsReconcile',
        actor_id: 'admin',
        action: 'create',
        result: 'success',
      }),
    );
  });

  it('rolls back the transaction when an applier throws', async () => {
    const { svc, scope, dataSource, audit } = makeService();
    scope.createNode.mockRejectedValueOnce(new Error('db down'));
    // DataSource.transaction propagates the error from the callback
    dataSource.transaction.mockImplementationOnce(async (cb: any) => {
      await cb({ query: vi.fn() });
    });
    await expect(
      svc.apply(plan, { actorId: 'admin', desiredObjects: new Map() }),
    ).rejects.toThrow(/db down/);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('supports dry-run: no transaction, no writes, no audit', async () => {
    const { svc, dataSource, audit } = makeService();
    const result = await svc.apply(plan, {
      actorId: 'admin',
      dryRun: true,
      desiredObjects: new Map(),
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
    expect(result.planned).toBe(3);
  });
});
