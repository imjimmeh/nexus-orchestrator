import { Injectable } from '@nestjs/common';
import {
  GITOPS_MANAGED_BY,
  RECONCILE_ORDER,
  reconcileKey,
} from './gitops.constants';
import type { ReconcileObjectType } from './gitops.constants.types';
import type {
  ActualState,
  DesiredState,
  ReconcileChange,
  ReconcileOp,
  ReconciliationPlan,
} from './reconciliation.types';
import type { GitOpsPendingChange } from './database/entities/gitops-pending-change.entity';
import type { ReconciliationDiffOptions } from './reconciliation-diff.service.types';

@Injectable()
export class ReconciliationDiffService {
  computePlan(
    desired: DesiredState,
    actual: ActualState,
    options: ReconciliationDiffOptions = {},
  ): ReconciliationPlan {
    const desiredByKey = new Map(
      desired.objects.map((o) => [reconcileKey(o.type, o.key), o]),
    );
    const actualByKey = new Map(
      actual.objects.map((o) => [reconcileKey(o.type, o.key), o]),
    );
    const pendingByKey = new Map(
      (options.pendingChanges ?? []).map((change) => [
        reconcileKey(change.objectType, change.objectKey),
        change,
      ]),
    );
    const changes: ReconcileChange[] = [];

    for (const want of desired.objects) {
      const have = actualByKey.get(reconcileKey(want.type, want.key));
      // An object in desired-state that exists in DB under non-gitops ownership is intentionally
      // skipped with no output — GitOps cannot claim ownership of manually-managed objects.
      if (have && have.managedBy !== GITOPS_MANAGED_BY) continue;
      if (!have) {
        changes.push(
          this.withPendingConflict(
            { type: want.type, key: want.key, op: 'create' },
            pendingByKey,
            options.lastAppliedRevision,
          ),
        );
        continue;
      }
      const diff = this.fieldDiff(have.fields, want.fields);
      if (Object.keys(diff).length === 0) {
        changes.push({ type: want.type, key: want.key, op: 'noop' });
      } else if (have.locked) {
        changes.push({
          type: want.type,
          key: want.key,
          op: 'noop',
          diff,
          skippedReason: 'object is locked',
        });
      } else {
        changes.push(
          this.withPendingConflict(
            { type: want.type, key: want.key, op: 'update', diff },
            pendingByKey,
            options.lastAppliedRevision,
          ),
        );
      }
    }

    for (const have of actual.objects) {
      if (desiredByKey.has(reconcileKey(have.type, have.key))) continue;
      if (have.managedBy !== GITOPS_MANAGED_BY) continue;
      const guard = this.pruneGuard(desired.prune, have);
      changes.push(
        guard
          ? { type: have.type, key: have.key, op: 'noop', skippedReason: guard }
          : this.withPendingConflict(
              { type: have.type, key: have.key, op: 'delete' },
              pendingByKey,
              options.lastAppliedRevision,
            ),
      );
    }

    return { changes: this.sort(changes), summary: this.summarize(changes) };
  }

  private withPendingConflict(
    change: ReconcileChange,
    pendingByKey: Map<string, GitOpsPendingChange>,
    lastAppliedRevision: string | null | undefined,
  ): ReconcileChange {
    const pendingChange = pendingByKey.get(
      reconcileKey(change.type, change.key),
    );
    if (!pendingChange) {
      return change;
    }

    if (
      pendingChange.baseRevision &&
      lastAppliedRevision &&
      pendingChange.baseRevision === lastAppliedRevision
    ) {
      return change;
    }

    return {
      ...change,
      op: 'noop',
      conflict: true,
      skippedReason: 'pending outbound change requires review',
    };
  }

  private pruneGuard(
    prune: boolean,
    have: ActualState['objects'][number],
  ): string | null {
    if (have.locked) return 'object is locked';
    if (have.hasForeignDescendants)
      return 'node has descendants not in desired-state';
    if (!prune) return 'prune not enabled';
    return null;
  }

  private fieldDiff(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    // Only fields declared in the desired-state are compared; undeclared DB fields are
    // not touched — GitOps manages what it declares, not the entire record schema.
    for (const key of Object.keys(to)) {
      if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
        diff[key] = { from: from[key], to: to[key] };
      }
    }
    return diff;
  }

  private sort(changes: ReconcileChange[]): ReconcileChange[] {
    const rank = (t: ReconcileObjectType) => RECONCILE_ORDER.indexOf(t);
    return [...changes].sort((a, b) => {
      const aDel = a.op === 'delete';
      const bDel = b.op === 'delete';
      if (aDel !== bDel) return aDel ? 1 : -1;
      const r = aDel
        ? rank(b.type) - rank(a.type)
        : rank(a.type) - rank(b.type);
      return r || a.key.localeCompare(b.key);
    });
  }

  private summarize(changes: ReconcileChange[]): Record<ReconcileOp, number> {
    const s: Record<ReconcileOp, number> = {
      create: 0,
      update: 0,
      delete: 0,
      noop: 0,
    };
    for (const c of changes) s[c.op] += 1;
    return s;
  }
}
