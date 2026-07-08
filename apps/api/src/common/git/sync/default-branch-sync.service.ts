import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { BranchOperationsService } from '../branch/branch-operations.service';
import { RepositoryLockService } from '../locking/repository-lock.service';
import { GitPathService } from '../path/git-path.service';
import { EventLedgerService } from '../../../observability/event-ledger.service';
import type { DefaultBranchSyncResult } from '../branch/branch-operations.service.types';

const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function resolveSyncIntervalMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_SYNC_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_SYNC_INTERVAL_MS;
  }
  return parsed;
}

/**
 * Periodically fast-forwards every persistent clone's local default branch to
 * `origin`, keeping the shared checkout from drifting. Diverged branches (a
 * clone carrying un-pushed local commits) are surfaced via the event ledger
 * rather than discarded, so an operator can investigate the offending workflow.
 */
@Injectable()
export class DefaultBranchSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DefaultBranchSyncService.name);
  private readonly intervalMs = resolveSyncIntervalMs(
    process.env.GIT_DEFAULT_BRANCH_SYNC_INTERVAL_MS,
  );
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly branchOps: BranchOperationsService,
    private readonly lockService: RepositoryLockService,
    private readonly pathService: GitPathService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileAll('startup');
    this.timer = setInterval(() => {
      void this.reconcileAll('interval');
    }, this.intervalMs);
    // Avoid keeping the event loop alive solely for this background timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcileAll(source: 'startup' | 'interval' | 'manual'): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const repoPaths = await this.listCloneRepoPaths();
      for (const repoPath of repoPaths) {
        await this.reconcileRepo(repoPath, source);
      }
    } finally {
      this.inFlight = false;
    }
  }

  async reconcileRepo(
    repoPath: string,
    source: 'startup' | 'interval' | 'manual',
  ): Promise<DefaultBranchSyncResult> {
    const result = await this.lockService.runRepoExclusive(repoPath, () =>
      this.branchOps.syncDefaultBranchToOrigin(repoPath),
    );

    if (result.status === 'diverged') {
      this.logger.warn(
        `Clone ${repoPath} default branch ${result.branch} has diverged from origin; leaving untouched`,
      );
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.default-branch.diverged',
        outcome: 'success',
        severity: 'warn',
        payload: { repoPath, branch: result.branch, source },
      });
    } else if (result.status === 'fast-forwarded') {
      this.logger.log(
        `Fast-forwarded clone ${repoPath} default branch ${result.branch} to origin`,
      );
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.default-branch.fast-forwarded',
        outcome: 'success',
        payload: { repoPath, branch: result.branch, source },
      });
    }

    return result;
  }

  private async listCloneRepoPaths(): Promise<string[]> {
    const clonesBase = this.pathService.getClonesBasePath();
    if (!clonesBase) {
      return [];
    }
    let entries;
    try {
      entries = await readdir(clonesBase, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(clonesBase, entry.name));
  }
}
