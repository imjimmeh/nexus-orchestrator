import { InternalServerErrorException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type {
  AuthErrorClass,
  GitCaptureResult,
  MergeResult,
} from './git-merge.service.types';

const execFileAsync = promisify(execFile);

type GitAuthEnv = Record<string, string>;

function gitProcessEnv(authEnv?: GitAuthEnv): NodeJS.ProcessEnv {
  return authEnv ? { ...process.env, ...authEnv } : process.env;
}

/** Run a git command, throwing a descriptive error on a non-zero exit. */
export async function runGitOrThrow(
  repoPath: string,
  args: string[],
  authEnv?: GitAuthEnv,
): Promise<void> {
  try {
    await execFileAsync('git', ['-C', repoPath, ...args], {
      env: gitProcessEnv(authEnv),
    });
  } catch (error) {
    const details = (error as { stderr?: string; message?: string }).stderr;
    throw new InternalServerErrorException(
      details?.trim() || (error as Error).message || `git ${args.join(' ')}`,
    );
  }
}

/** Run a git command, capturing its exit code/output instead of throwing. */
export async function runGitCapturing(
  repoPath: string,
  args: string[],
  authEnv?: GitAuthEnv,
): Promise<GitCaptureResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['-C', repoPath, ...args],
      { env: gitProcessEnv(authEnv) },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** Split git stdout into trimmed, non-empty lines. */
export function parseGitLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function gitEventContext(scopeId: string) {
  return {
    scopeId,
    contextId: null,
    contextType: null,
    scopeNodeId: null,
    scopePath: null,
  };
}

export async function emitMergeRequested(
  eventLedger: EventLedgerService,
  scopeId: string,
  sourceBranch: string,
  destinationBranch: string,
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'git',
    eventName: 'git.merge.requested',
    outcome: 'in_progress',
    context: gitEventContext(scopeId),
    payload: { sourceBranch, destinationBranch },
  });
}

/**
 * Record that a worktree's uncommitted/untracked scratch was discarded before a
 * base→feature merge, so the audit trail shows exactly what was removed (the
 * deliverable is already committed by the time a work item is ready to merge).
 */
export async function emitWorktreeCleaned(
  eventLedger: EventLedgerService,
  scopeId: string,
  worktreePath: string,
  discardedPaths: string[],
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'git',
    eventName: 'git.merge.worktree_cleaned',
    outcome: 'success',
    severity: 'warn',
    context: gitEventContext(scopeId),
    payload: {
      worktreePath,
      discardedPathCount: discardedPaths.length,
      discardedPaths,
    },
  });
}

export async function emitMergeOutcome(
  eventLedger: EventLedgerService,
  scopeId: string,
  result: MergeResult,
  error?: unknown,
): Promise<void> {
  const eventName =
    result.outcome === 'succeeded'
      ? 'git.merge.succeeded'
      : result.outcome === 'conflict'
        ? 'git.merge.conflict_detected'
        : result.outcome === 'quality_gate_failed'
          ? 'git.merge.quality_gate_failed'
          : 'git.merge.failed';

  await eventLedger.emitBestEffort({
    domain: 'git',
    eventName,
    outcome: result.outcome === 'succeeded' ? 'success' : 'failure',
    context: gitEventContext(scopeId),
    payload: { ...result },
    ...(error ? { errorMessage: (error as Error).message } : {}),
  });
}

/** Pull the most descriptive error text from a rejected git invocation. */
export function extractMergeError(error: unknown): string {
  return (
    (error as { stderr?: string }).stderr ?? (error as Error).message ?? ''
  );
}

export function isMergeConflict(stderr: string): boolean {
  return stderr.includes('CONFLICT') || stderr.includes('Merge conflict');
}

export function isPushRejected(stderr: string): boolean {
  return (
    stderr.includes('failed to push some refs') ||
    stderr.includes('non-fast-forward') ||
    stderr.includes('fetch first') ||
    stderr.includes('[rejected]')
  );
}

/**
 * A push aborted by a LOCAL pre-push hook (a quality gate such as lint/tests),
 * as opposed to a remote-side rejection (non-fast-forward). Git prints
 * "failed to push some refs" in both cases, so the remote-rejection markers are
 * excluded to isolate the hook decline — which a retry against latest origin
 * cannot fix.
 */
export function isPrePushHookFailure(stderr: string): boolean {
  if (!stderr.includes('failed to push some refs')) {
    return false;
  }
  const remoteRejection =
    stderr.includes('[rejected]') ||
    stderr.includes('non-fast-forward') ||
    stderr.includes('fetch first');
  return !remoteRejection;
}

/** A merge aborted because the working tree carried uncommitted changes. */
export function isLocalChangesOverwrite(stderr: string): boolean {
  return (
    stderr.includes(
      'local changes to the following files would be overwritten',
    ) || stderr.includes('Please commit your changes or stash them')
  );
}

export function classifyAuthError(stderr: string): AuthErrorClass | undefined {
  const normalized = stderr.toLowerCase();

  if (
    normalized.includes('authentication failed') ||
    normalized.includes('could not read username') ||
    normalized.includes('could not read password') ||
    normalized.includes('permission denied (publickey)') ||
    normalized.includes('http basic: access denied') ||
    normalized.includes('fatal: could not read from remote repository') ||
    normalized.includes('error: 401') ||
    normalized.includes('error: 403')
  ) {
    return 'credentials';
  }

  if (
    normalized.includes('could not resolve host') ||
    normalized.includes('connection timed out') ||
    normalized.includes('failed to connect')
  ) {
    return 'network';
  }

  if (
    normalized.includes('remote rejected') ||
    normalized.includes('pre-receive hook declined')
  ) {
    return 'permission';
  }

  return undefined;
}

/** Human-readable message for a non-conflict, non-auth merge failure. */
export function describeNonConflictFailure(
  stderr: string,
  error: unknown,
): string {
  if (isLocalChangesOverwrite(stderr)) {
    return (
      'Merge blocked: uncommitted local changes in the working tree would be ' +
      `overwritten by the merge. ${stderr.trim()}`
    );
  }
  return stderr.trim() || (error as Error).message;
}

export function conflictResult(
  sourceBranch: string,
  destinationBranch: string,
  conflictedFiles: string[],
): MergeResult {
  return {
    outcome: 'conflict',
    sourceBranch,
    destinationBranch,
    conflictedFiles,
    message: `Merge conflicts detected in ${conflictedFiles.length} file(s)`,
  };
}

export function authErrorResult(
  sourceBranch: string,
  destinationBranch: string,
  message: string,
  authErrorClass: AuthErrorClass,
): MergeResult {
  return {
    outcome: 'auth_error',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message,
    authErrorClass,
  };
}

export function failedResult(
  sourceBranch: string,
  destinationBranch: string,
  message: string,
): MergeResult {
  return {
    outcome: 'failed',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message,
  };
}

/**
 * Result for a successful stage-1 worktree preparation: the base has been merged
 * into the context worktree (or was already contained) with no conflicts, and no
 * integration push has been attempted yet.
 */
export function worktreePreparedResult(
  sourceBranch: string,
  destinationBranch: string,
): MergeResult {
  return {
    outcome: 'succeeded',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message: `Worktree prepared: ${destinationBranch} merged into ${sourceBranch}; ready for the quality gate`,
  };
}

export function qualityGateFailedResult(
  sourceBranch: string,
  destinationBranch: string,
  qualityGateLog: string,
): MergeResult {
  return {
    outcome: 'quality_gate_failed',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message:
      'Push rejected by the pre-push quality gate (lint/tests). ' +
      'See qualityGateLog for the full output.',
    qualityGateLog,
  };
}

/** Result when the shared clone has no files blocking direct source integration. */
export function sharedCloneCleanResult(
  sourceBranch: string,
  destinationBranch: string,
  sharedClonePath: string,
): MergeResult {
  return {
    outcome: 'succeeded',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    dirtyPaths: [],
    sharedClonePath,
    message: `Shared clone is clean for integrating ${sourceBranch} into ${destinationBranch}`,
  };
}

/** Result when the shared clone has files that must be reconciled before integration. */
export function sharedCloneDirtyResult(
  sourceBranch: string,
  destinationBranch: string,
  sharedClonePath: string,
  dirtyPaths: string[],
): MergeResult {
  return {
    outcome: 'shared_clone_dirty',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    dirtyPaths,
    sharedClonePath,
    message:
      `Shared clone has files that must be reconciled before integration: ` +
      dirtyPaths.join(', '),
  };
}
