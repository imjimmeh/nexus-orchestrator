import { Logger } from '@nestjs/common';
import {
  access,
  constants as fsConstants,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import * as path from 'node:path';
import { isErrorEnvelope, errorEnvelopeToString } from '@nexus/core';
import { WorktreeOperationsService } from './worktree/worktree-operations.service';
import { isWorktreeInitialized } from './worktree/worktree.types';
import { pruneWorktreesBestEffort } from './git-worktree-ops.util';
import type { EventLedgerService } from '../../observability/event-ledger.service';

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removeOrphanDirectory(params: {
  logger: Logger;
  scopeId: string;
  contextId: string;
  worktreePath: string;
}): Promise<void> {
  const { logger, scopeId, contextId, worktreePath } = params;
  if (!(await pathExists(worktreePath))) {
    return;
  }

  try {
    await rm(worktreePath, { recursive: true, force: true });
    logger.log(
      `Removed orphaned worktree directory for ${scopeId}/${contextId}: ${worktreePath}`,
    );
  } catch (error) {
    logger.warn(
      `Failed to remove orphaned worktree directory ${worktreePath} for ${scopeId}/${contextId}: ${(error as Error).message}`,
    );
  }
}

export async function hasLinkedWorktreeGitMarker(
  worktreePath: string,
): Promise<boolean> {
  const gitMarkerPath = path.join(worktreePath, '.git');

  try {
    const metadata = await stat(gitMarkerPath);
    if (!metadata.isFile()) {
      return false;
    }

    const marker = await readFile(gitMarkerPath, 'utf8');
    return marker.trimStart().startsWith('gitdir: ');
  } catch {
    return false;
  }
}

function provisionErrToString(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export async function removeStaleWorktreeRegistration(params: {
  worktreeOps: WorktreeOperationsService;
  eventLedger: Pick<EventLedgerService, 'emitBestEffort'>;
  logger: Logger;
  repoPath: string;
  worktreePath: string;
  scopeId: string;
  contextId: string;
}): Promise<void> {
  const {
    worktreeOps,
    eventLedger,
    logger,
    repoPath,
    worktreePath,
    scopeId,
    contextId,
  } = params;

  logger.warn(
    `Detected stale worktree for ${scopeId}/${contextId}; removing before re-provisioning`,
  );

  try {
    await worktreeOps.removeWorktree(repoPath, worktreePath);
  } catch (removeErr: unknown) {
    if (isErrorEnvelope(removeErr) && removeErr.kind === 'worktree.io') {
      await eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.worktree.io_error',
        outcome: 'failure',
        context: {
          scopeId: scopeId,
          contextId: contextId,
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        payload: { path: worktreePath },
        errorMessage: errorEnvelopeToString(removeErr),
      });
      throw removeErr;
    }
    logger.warn(
      `Force-remove of stale worktree registration failed (will continue): ${errorEnvelopeToString(
        isErrorEnvelope(removeErr)
          ? removeErr
          : {
              kind: 'unknown' as const,
              message: provisionErrToString(removeErr),
            },
      )}`,
    );
  }

  await removeOrphanDirectory({ logger, scopeId, contextId, worktreePath });
  await pruneWorktreesBestEffort({
    worktreeOps,
    logger,
    repoPath,
    scopeId,
  });
}

export async function validateWorktreePath(params: {
  worktreeOps: WorktreeOperationsService;
  logger: Logger;
  repoPath: string;
  worktreePath: string;
  scopeId: string;
  contextId: string;
}): Promise<string | null> {
  const { worktreeOps, logger, repoPath, worktreePath, scopeId, contextId } =
    params;

  if (!(await pathExists(worktreePath))) {
    return null;
  }

  const registered = await worktreeOps.findWorktreeByPath(
    repoPath,
    worktreePath,
  );

  if (!registered) {
    logger.warn(
      `Ignoring stale unregistered worktree path for ${scopeId}/${contextId}: ${worktreePath}`,
    );
    return null;
  }

  if (!isWorktreeInitialized(registered)) {
    logger.warn(
      `Ignoring stale uninitialized worktree (HEAD=${registered.head ?? 'unknown'}) for ${scopeId}/${contextId}: ${worktreePath}`,
    );
    return null;
  }

  const gitMarkerPath = path.join(worktreePath, '.git');
  if (!(await pathExists(gitMarkerPath))) {
    logger.warn(
      `Ignoring invalid worktree missing .git marker for ${scopeId}/${contextId}: ${worktreePath}`,
    );
    return null;
  }

  if (!(await hasLinkedWorktreeGitMarker(worktreePath))) {
    logger.warn(
      `Ignoring invalid worktree .git marker format for ${scopeId}/${contextId} (expected linked-worktree gitdir file): ${worktreePath}`,
    );
    return null;
  }

  return worktreePath;
}
