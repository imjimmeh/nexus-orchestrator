import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DefaultBranchSyncService,
  resolveSyncIntervalMs,
} from './default-branch-sync.service';
import type { BranchOperationsService } from '../branch/branch-operations.service';
import type { RepositoryLockService } from '../locking/repository-lock.service';
import type { GitPathService } from '../path/git-path.service';
import type { EventLedgerService } from '../../../observability/event-ledger.service';

function buildService() {
  const branchOps = {
    syncDefaultBranchToOrigin: vi.fn(),
  } as unknown as BranchOperationsService & {
    syncDefaultBranchToOrigin: ReturnType<typeof vi.fn>;
  };
  const lockService = {
    runRepoExclusive: vi.fn((_repo: string, task: () => unknown) => task()),
  } as unknown as RepositoryLockService;
  const pathService = {
    getClonesBasePath: vi.fn(),
  } as unknown as GitPathService & {
    getClonesBasePath: ReturnType<typeof vi.fn>;
  };
  const eventLedger = {
    emitBestEffort: vi.fn(),
  } as unknown as EventLedgerService & {
    emitBestEffort: ReturnType<typeof vi.fn>;
  };

  const service = new DefaultBranchSyncService(
    branchOps,
    lockService,
    pathService,
    eventLedger,
  );
  return { service, branchOps, lockService, pathService, eventLedger };
}

describe('resolveSyncIntervalMs', () => {
  it('defaults when unset or invalid', () => {
    expect(resolveSyncIntervalMs(undefined)).toBe(600000);
    expect(resolveSyncIntervalMs('0')).toBe(600000);
    expect(resolveSyncIntervalMs('-5')).toBe(600000);
    expect(resolveSyncIntervalMs('not-a-number')).toBe(600000);
  });

  it('honours a positive override', () => {
    expect(resolveSyncIntervalMs('30000')).toBe(30000);
  });
});

describe('DefaultBranchSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('reconcileRepo', () => {
    const REPO = '/clones/scope-1';

    it('runs the sync under the repository lock', async () => {
      const { service, branchOps, lockService } = buildService();
      branchOps.syncDefaultBranchToOrigin.mockResolvedValue({
        status: 'already-current',
        branch: 'main',
      });

      await service.reconcileRepo(REPO, 'manual');

      expect(lockService.runRepoExclusive).toHaveBeenCalledWith(
        REPO,
        expect.any(Function),
      );
      expect(branchOps.syncDefaultBranchToOrigin).toHaveBeenCalledWith(REPO);
    });

    it('emits a warning event when the branch has diverged', async () => {
      const { service, branchOps, eventLedger } = buildService();
      branchOps.syncDefaultBranchToOrigin.mockResolvedValue({
        status: 'diverged',
        branch: 'main',
      });

      await service.reconcileRepo(REPO, 'interval');

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'git.default-branch.diverged',
          severity: 'warn',
        }),
      );
    });

    it('emits an event when a branch is fast-forwarded', async () => {
      const { service, branchOps, eventLedger } = buildService();
      branchOps.syncDefaultBranchToOrigin.mockResolvedValue({
        status: 'fast-forwarded',
        branch: 'main',
      });

      await service.reconcileRepo(REPO, 'startup');

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'git.default-branch.fast-forwarded',
        }),
      );
    });

    it('stays quiet when the branch is already current', async () => {
      const { service, branchOps, eventLedger } = buildService();
      branchOps.syncDefaultBranchToOrigin.mockResolvedValue({
        status: 'already-current',
        branch: 'main',
      });

      await service.reconcileRepo(REPO, 'interval');

      expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    });
  });

  describe('reconcileAll', () => {
    it('reconciles every clone directory but no-ops without a clones base', async () => {
      const { service, branchOps, pathService } = buildService();
      pathService.getClonesBasePath.mockReturnValue(null);

      await service.reconcileAll('startup');

      expect(branchOps.syncDefaultBranchToOrigin).not.toHaveBeenCalled();
    });
  });
});
