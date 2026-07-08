import { describe, it, expect } from 'vitest';
import { ReconciliationDiffService } from './reconciliation-diff.service';
import type { DesiredState, ActualState } from './reconciliation.types';
import { GITOPS_MANAGED_BY } from './gitops.constants';
import type { GitOpsPendingChange } from './database/entities/gitops-pending-change.entity';

const svc = new ReconciliationDiffService();

const desired: DesiredState = {
  prune: false,
  objects: [
    { type: 'role', key: 'viewer', fields: { description: 'Read-only' } },
    { type: 'role', key: 'member', fields: { description: 'Members v2' } },
    {
      type: 'scope_node',
      key: 'org-acme',
      fields: { type: 'org', name: 'Acme', slug: 'acme', parentId: null },
    },
    {
      type: 'role_assignment',
      key: 'u1:viewer:org-acme',
      fields: { userId: 'u1', roleId: 'viewer', scopeNodeId: 'org-acme' },
    },
  ],
};

const actual: ActualState = {
  objects: [
    {
      type: 'role',
      key: 'viewer',
      fields: { description: 'Read-only' },
      managedBy: GITOPS_MANAGED_BY,
      locked: false,
    },
    {
      type: 'role',
      key: 'member',
      fields: { description: 'Members v1' },
      managedBy: GITOPS_MANAGED_BY,
      locked: false,
    },
    {
      type: 'scope_node',
      key: 'org-stale',
      fields: { type: 'org', name: 'Stale', slug: 'stale', parentId: null },
      managedBy: GITOPS_MANAGED_BY,
      locked: false,
      hasForeignDescendants: false,
    },
    {
      type: 'scope_node',
      key: 'org-manual',
      fields: { type: 'org', name: 'Manual', slug: 'manual', parentId: null },
      managedBy: 'manual',
      locked: false,
    },
  ],
};

describe('ReconciliationDiffService.computePlan', () => {
  it('produces create for git-only managed objects', () => {
    const plan = svc.computePlan(desired, actual);
    const created = plan.changes
      .filter((c) => c.op === 'create')
      .map((c) => c.key);
    expect(created).toContain('org-acme');
    expect(created).toContain('u1:viewer:org-acme');
  });

  it('produces update with a field diff for divergent managed objects', () => {
    const plan = svc.computePlan(desired, actual);
    const change = plan.changes.find((c) => c.key === 'member');
    expect(change?.op).toBe('update');
    expect(change?.diff).toEqual({
      description: { from: 'Members v1', to: 'Members v2' },
    });
  });

  it('emits noop for objects that already match', () => {
    const plan = svc.computePlan(desired, actual);
    expect(plan.changes.find((c) => c.key === 'viewer')?.op).toBe('noop');
  });

  it('does NOT delete db-only objects when prune is false (downgraded to noop with reason)', () => {
    const plan = svc.computePlan(desired, actual);
    const stale = plan.changes.find((c) => c.key === 'org-stale');
    expect(stale?.op).toBe('noop');
    expect(stale?.skippedReason).toMatch(/prune/i);
  });

  it('deletes db-only managed objects when prune is true', () => {
    const plan = svc.computePlan({ ...desired, prune: true }, actual);
    expect(plan.changes.find((c) => c.key === 'org-stale')?.op).toBe('delete');
  });

  it('NEVER touches unmanaged objects, even with prune', () => {
    const plan = svc.computePlan({ ...desired, prune: true }, actual);
    expect(plan.changes.find((c) => c.key === 'org-manual')).toBeUndefined();
  });

  it('orders changes nodes → roles → assignments → overrides', () => {
    const plan = svc.computePlan({ ...desired, prune: true }, actual);
    const typeSeq = plan.changes
      .filter((c) => c.op !== 'noop')
      .map((c) => c.type);
    const firstNode = typeSeq.indexOf('scope_node');
    const firstAssignment = typeSeq.indexOf('role_assignment');
    expect(firstNode).toBeLessThan(firstAssignment);
  });

  it('NEVER emits changes for unmanaged objects even if they appear in desired-state', () => {
    const desiredWithUnmanaged: DesiredState = {
      prune: true,
      objects: [
        { type: 'role', key: 'viewer', fields: { description: 'Read-only' } },
        // manual-org also in desired — must still be ignored
        {
          type: 'scope_node',
          key: 'org-manual',
          fields: {
            type: 'org',
            name: 'Manual-updated',
            slug: 'manual',
            parentId: null,
          },
        },
      ],
    };
    const plan = svc.computePlan(desiredWithUnmanaged, actual);
    // org-manual is in actual with managedBy: 'manual' — must not appear in changes
    expect(plan.changes.find((c) => c.key === 'org-manual')).toBeUndefined();
  });

  it('summarizes counts per op', () => {
    const plan = svc.computePlan({ ...desired, prune: true }, actual);
    expect(plan.summary.create).toBeGreaterThanOrEqual(2);
    expect(plan.summary.delete).toBe(1);
  });

  it('marks inbound changes as conflicts when pending outbound changes exist for the same object', () => {
    const plan = svc.computePlan(desired, actual, {
      pendingChanges: [
        {
          objectType: 'role',
          objectKey: 'member',
          baseRevision: 'old-revision',
        } as GitOpsPendingChange,
      ],
      lastAppliedRevision: 'current-revision',
    });

    const change = plan.changes.find((candidate) => candidate.key === 'member');
    expect(change).toMatchObject({
      op: 'noop',
      conflict: true,
      skippedReason: 'pending outbound change requires review',
    });
  });

  it('does not mark a pending outbound change as conflict when it is based on the current revision', () => {
    const plan = svc.computePlan(desired, actual, {
      pendingChanges: [
        {
          objectType: 'role',
          objectKey: 'member',
          baseRevision: 'current-revision',
        } as GitOpsPendingChange,
      ],
      lastAppliedRevision: 'current-revision',
    });

    const change = plan.changes.find((candidate) => candidate.key === 'member');
    expect(change).toMatchObject({ op: 'update' });
    expect(change?.conflict).toBeUndefined();
  });
});
