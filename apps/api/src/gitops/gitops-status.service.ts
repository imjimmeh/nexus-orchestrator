import { Injectable } from '@nestjs/common';
import { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import { GitOpsReconcileRunRepository } from './database/repositories/gitops-reconcile-run.repository';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import type {
  DriftSummary,
  GitOpsBindingStatus,
  GitOpsRunSummary,
  GitOpsStatusResponse,
  ReconcileSummary,
} from './gitops-status.types';

interface SummaryCounts {
  create: number;
  update: number;
  prune: number;
  drift: number;
}

interface PendingChangeRecord {
  bindingId: string;
  changeType: string;
  status: string;
}

const ACTIVE_PENDING_CHANGE_STATUS = 'pending';

const EMPTY_SUMMARY_COUNTS: SummaryCounts = {
  create: 0,
  update: 0,
  prune: 0,
  drift: 0,
};

@Injectable()
export class GitOpsStatusService {
  constructor(
    private readonly bindings: GitOpsRepositoryBindingRepository,
    private readonly runs: GitOpsReconcileRunRepository,
    private readonly pendingChanges: GitOpsPendingChangeRepository,
  ) {}

  async getStatus(): Promise<GitOpsStatusResponse> {
    const [bindingRows, runRows, pendingChangeRows] = await Promise.all([
      this.bindings.findAll(),
      this.runs.findAll(),
      this.pendingChanges.findAll(),
    ]);

    const activePendingChangeRows = pendingChangeRows.filter((pendingChange) =>
      this.isActivePendingChange(pendingChange.status),
    );

    const latestRunByBindingId = new Map<string, GitOpsRunSummary>();
    for (const run of runRows) {
      if (!latestRunByBindingId.has(run.bindingId)) {
        latestRunByBindingId.set(run.bindingId, {
          id: run.id,
          bindingId: run.bindingId,
          direction: run.direction,
          status: run.status,
          revision: run.revision,
          summary: run.summary,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        });
      }
    }

    const pendingChangesByBindingId = this.groupPendingChangesByBindingId(
      activePendingChangeRows,
    );

    const bindings = bindingRows.map<GitOpsBindingStatus>((binding) => {
      const bindingPendingChanges =
        pendingChangesByBindingId.get(binding.id) ?? [];
      return {
        bindingId: binding.id,
        name: binding.name,
        scopeNodeId: binding.scopeNodeId,
        syncMode: binding.syncMode,
        enabled: binding.enabled,
        lastAppliedRevision: binding.lastAppliedRevision,
        latestRun: latestRunByBindingId.get(binding.id) ?? null,
        pendingChangeCount: bindingPendingChanges.length,
        driftCount: bindingPendingChanges.filter((pendingChange) =>
          this.isDriftChange(pendingChange.changeType),
        ).length,
      };
    });

    const lastReconcile = this.buildLastReconcile(runRows);
    const drift = this.buildDriftSummaries(activePendingChangeRows);

    return {
      bindings,
      lastReconcile,
      drift,
      managedByCounts: { gitops: bindings.length, manual: 0, seed: 0 },
    };
  }

  private buildLastReconcile(
    runRows: Array<{
      id: string;
      status: string;
      summary: string | null;
      finishedAt: Date | null;
    }>,
  ): ReconcileSummary | null {
    const latestFinishedRun = [...runRows]
      .filter((run) => run.finishedAt !== null)
      .sort((left, right) => {
        const rightTime = right.finishedAt?.getTime() ?? 0;
        const leftTime = left.finishedAt?.getTime() ?? 0;
        return rightTime - leftTime;
      })[0];
    if (!latestFinishedRun) {
      return null;
    }

    return {
      id: latestFinishedRun.id,
      finishedAt:
        latestFinishedRun.finishedAt?.toISOString() ??
        new Date(0).toISOString(),
      result: latestFinishedRun.status === 'failure' ? 'failure' : 'success',
      summary: this.parseSummaryCounts(latestFinishedRun.summary),
      dryRun: false,
      auditEventId: latestFinishedRun.id,
    };
  }

  private buildDriftSummaries(
    pendingChangeRows: Array<{
      id: string;
      objectType: string;
      objectKey: string;
      scopeNodeId: string;
      changeType: string;
      bindingId: string;
      status: string;
    }>,
  ): DriftSummary[] {
    return pendingChangeRows
      .filter((pendingChange) => this.isDriftChange(pendingChange.changeType))
      .map((pendingChange) => ({
        kind: pendingChange.objectType,
        name: pendingChange.objectKey,
        scopeNodeId: pendingChange.scopeNodeId,
        managedBy: 'gitops',
        driftedFields: [pendingChange.changeType],
        auditEventId: pendingChange.id,
      }));
  }

  private groupPendingChangesByBindingId(
    pendingChangeRows: PendingChangeRecord[],
  ): Map<string, PendingChangeRecord[]> {
    const grouped = new Map<string, PendingChangeRecord[]>();

    for (const pendingChange of pendingChangeRows) {
      const list = grouped.get(pendingChange.bindingId) ?? [];
      list.push(pendingChange);
      grouped.set(pendingChange.bindingId, list);
    }

    return grouped;
  }

  private isDriftChange(changeType: string): boolean {
    return changeType === 'drift';
  }

  private isActivePendingChange(status: string): boolean {
    return status === ACTIVE_PENDING_CHANGE_STATUS;
  }

  private parseSummaryCounts(summary: string | null): SummaryCounts {
    if (!summary) {
      return EMPTY_SUMMARY_COUNTS;
    }

    try {
      const parsed = JSON.parse(summary) as Partial<SummaryCounts>;
      return {
        create: this.toCount(parsed.create),
        update: this.toCount(parsed.update),
        prune: this.toCount(parsed.prune),
        drift: this.toCount(parsed.drift),
      };
    } catch {
      return EMPTY_SUMMARY_COUNTS;
    }
  }

  private toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
