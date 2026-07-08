import { Logger } from '@nestjs/common';
import { BranchOperationsService } from './branch/branch-operations.service';
import { GitCommandService } from './git-command/git-command.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorktreeOperationsService } from './worktree/worktree-operations.service';

type DeleteBranchBestEffortParams = {
  gitCommand: GitCommandService;
  logger: Logger;
  repoPath: string;
  branchName: string;
  scopeId: string;
  contextId: string;
};

type PruneWorktreesBestEffortParams = {
  worktreeOps: WorktreeOperationsService;
  logger: Logger;
  repoPath: string;
  scopeId: string;
};

type PushBranchBestEffortParams = {
  branchOps: BranchOperationsService;
  gitCommand: GitCommandService;
  eventLedger: EventLedgerService;
  logger: Logger;
  repoPath: string;
  branchName: string;
  context?: { scopeId?: string; contextId?: string };
};

export async function deleteBranchBestEffort(
  params: DeleteBranchBestEffortParams,
): Promise<void> {
  try {
    await params.gitCommand.exec(params.repoPath, [
      'branch',
      '-D',
      params.branchName,
    ]);
  } catch (error) {
    params.logger.warn(
      `Failed to delete branch ${params.branchName} for ${params.scopeId}/${params.contextId}: ${(error as Error).message}`,
    );
  }
}

export async function pruneWorktreesBestEffort(
  params: PruneWorktreesBestEffortParams,
): Promise<void> {
  try {
    await params.worktreeOps.pruneWorktrees(params.repoPath);
  } catch (error) {
    params.logger.warn(
      `Failed to prune worktrees for project ${params.scopeId}: ${(error as Error).message}`,
    );
  }
}

export async function pushBranchBestEffort(
  params: PushBranchBestEffortParams,
): Promise<boolean> {
  const hasRemote = await params.branchOps.hasOriginRemote(params.repoPath);
  if (!hasRemote) {
    await emitSkippedPush(params);
    return false;
  }

  try {
    await params.gitCommand.exec(params.repoPath, [
      'push',
      '--set-upstream',
      'origin',
      params.branchName,
    ]);
    params.logger.log(`Pushed branch ${params.branchName} to origin`);
    await emitPushOutcome(params, 'git.branch.push.succeeded', 'success');
    return true;
  } catch (error) {
    params.logger.warn(
      `Failed to push branch ${params.branchName} to origin: ${(error as Error).message}`,
    );
    await emitPushOutcome(
      params,
      'git.branch.push.failed',
      'failure',
      (error as Error).message,
    );
    return false;
  }
}

async function emitSkippedPush(params: PushBranchBestEffortParams) {
  params.logger.debug(
    `No origin remote configured — skipping push for ${params.branchName}`,
  );
  await emitPushOutcome(
    params,
    'git.branch.push.skipped',
    'denied',
    undefined,
    'origin_remote_missing',
  );
}

async function emitPushOutcome(
  params: PushBranchBestEffortParams,
  eventName: string,
  outcome: 'success' | 'failure' | 'denied',
  errorMessage?: string,
  reason?: string,
) {
  await params.eventLedger.emitBestEffort({
    domain: 'git',
    eventName,
    outcome,
    context: {
      scopeId: params.context?.scopeId ?? null,
      contextId: params.context?.contextId ?? null,
      contextType: params.context?.contextId ? 'resource' : null,
      scopeNodeId: null,
      scopePath: null,
    },
    payload: {
      repoPath: params.repoPath,
      branchName: params.branchName,
      ...(reason ? { reason } : {}),
    },
    ...(errorMessage ? { errorMessage } : {}),
  });
}
