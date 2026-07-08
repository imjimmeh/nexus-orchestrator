import { InternalServerErrorException } from '@nestjs/common';
import type { MergeResult } from './git-merge.service.types';
import {
  authErrorResult,
  classifyAuthError,
  conflictResult,
  describeNonConflictFailure,
  extractMergeError,
  failedResult,
  isMergeConflict,
  isPrePushHookFailure,
  isPushRejected,
  qualityGateFailedResult,
} from './git-merge.helpers';
import type { GitIntegrationRunner } from './git-merge-integration.helpers.types';

type GitAuthEnv = Record<string, string>;

export type { GitIntegrationRunner } from './git-merge-integration.helpers.types';

/**
 * Stage 2: bring the clone root's base to a clean, current state and merge the
 * resolved feature branch into it, pushing hook-free.
 */
export async function integrateIntoBase(
  runner: GitIntegrationRunner,
  cloneRoot: string,
  sourceBranch: string,
  destinationBranch: string,
  authEnv: GitAuthEnv,
): Promise<MergeResult> {
  await prepareCleanBase(runner, cloneRoot, destinationBranch, authEnv);
  try {
    return await mergeAndPushBranch(
      runner,
      cloneRoot,
      sourceBranch,
      destinationBranch,
      authEnv,
    );
  } catch (error) {
    return handleMergeFailure(
      runner,
      cloneRoot,
      sourceBranch,
      destinationBranch,
      error,
      authEnv,
    );
  }
}

/**
 * Reset the clone root's base branch to `origin/<base>` so neither a stale
 * local base nor an uncommitted working tree (e.g. generated docs another
 * workflow left behind) can block or distort the integration merge.
 */
async function prepareCleanBase(
  runner: GitIntegrationRunner,
  cloneRoot: string,
  destinationBranch: string,
  authEnv: GitAuthEnv,
): Promise<void> {
  await checkoutForce(runner, cloneRoot, destinationBranch, authEnv);
  try {
    await runner.fetchOriginBranch(cloneRoot, destinationBranch, authEnv);
  } catch (error) {
    // Offline integration falls back to the local base; auth issues surface
    // through the subsequent push rather than failing the reset.
    runner.logger.warn(
      `prepareCleanBase: fetch of origin/${destinationBranch} failed; using local ref: ${(error as Error).message}`,
    );
  }
  if (await runner.refExists(cloneRoot, `origin/${destinationBranch}`)) {
    await runner.runGit(
      cloneRoot,
      ['reset', '--hard', `origin/${destinationBranch}`],
      authEnv,
    );
  }
}

async function checkoutForce(
  runner: GitIntegrationRunner,
  repoPath: string,
  branch: string,
  authEnv: GitAuthEnv,
): Promise<void> {
  try {
    await runner.runGit(repoPath, ['checkout', '-f', branch], authEnv);
  } catch {
    // Base branch not present locally yet — create it tracking origin.
    await runner.runGit(
      repoPath,
      ['checkout', '-f', '-B', branch, `origin/${branch}`],
      authEnv,
    );
  }
}

async function mergeAndPushBranch(
  runner: GitIntegrationRunner,
  repoPath: string,
  sourceBranch: string,
  destinationBranch: string,
  authEnv: GitAuthEnv,
): Promise<MergeResult> {
  await runner.runGit(repoPath, ['checkout', destinationBranch], authEnv);

  const baseMergeCommit = await runner.revParseHead(repoPath);

  await runner.runGit(
    repoPath,
    ['merge', '--no-ff', '--no-edit', sourceBranch],
    authEnv,
  );

  const mergeCommit = await runner.revParseHead(repoPath);

  if (baseMergeCommit === mergeCommit) {
    runner.logger.warn(
      `Merge of ${sourceBranch} into ${destinationBranch} produced no new commit (HEAD unchanged at ${baseMergeCommit.slice(0, 8)}). ` +
        `The source branch may have had no commits beyond ${destinationBranch}.`,
    );
  }

  const push = await runner.runGitCapture(
    repoPath,
    [
      '-c',
      'core.hooksPath=/dev/null',
      'push',
      '--set-upstream',
      'origin',
      destinationBranch,
    ],
    authEnv,
  );
  if (push.code !== 0) {
    const combined = [push.stdout, push.stderr]
      .map((stream) => stream.trim())
      .filter((stream) => stream.length > 0)
      .join('\n');
    throw new InternalServerErrorException(combined || 'git push failed');
  }

  return {
    outcome: 'succeeded',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message: `Successfully merged ${sourceBranch} into ${destinationBranch}`,
    baseMergeCommit,
    mergeCommit,
  };
}

async function handleMergeFailure(
  runner: GitIntegrationRunner,
  repoPath: string,
  sourceBranch: string,
  destinationBranch: string,
  error: unknown,
  authEnv: GitAuthEnv,
): Promise<MergeResult> {
  const stderr = extractMergeError(error);
  if (isPrePushHookFailure(stderr)) {
    // A local pre-push quality gate (lint/tests) declined the push. Retrying
    // against latest origin cannot fix it; surface the log for remediation.
    return qualityGateFailedResult(sourceBranch, destinationBranch, stderr);
  }
  if (isPushRejected(stderr)) {
    return retryMergeAgainstLatestOrigin(
      runner,
      repoPath,
      sourceBranch,
      destinationBranch,
      authEnv,
    );
  }
  return classifyIntegrationFailure(
    runner,
    repoPath,
    sourceBranch,
    destinationBranch,
    error,
  );
}

async function retryMergeAgainstLatestOrigin(
  runner: GitIntegrationRunner,
  repoPath: string,
  sourceBranch: string,
  destinationBranch: string,
  authEnv: GitAuthEnv,
): Promise<MergeResult> {
  try {
    await runner.fetchOriginBranch(repoPath, destinationBranch, authEnv);
    await runner.runGit(
      repoPath,
      ['reset', '--hard', `origin/${destinationBranch}`],
      authEnv,
    );
    return await mergeAndPushBranch(
      runner,
      repoPath,
      sourceBranch,
      destinationBranch,
      authEnv,
    );
  } catch (error) {
    return classifyIntegrationFailure(
      runner,
      repoPath,
      sourceBranch,
      destinationBranch,
      error,
    );
  }
}

/** Classify a clone-root integration failure (aborts the merge afterwards). */
async function classifyIntegrationFailure(
  runner: GitIntegrationRunner,
  repoPath: string,
  sourceBranch: string,
  destinationBranch: string,
  error: unknown,
): Promise<MergeResult> {
  const stderr = extractMergeError(error);
  const authErrorClass = classifyAuthError(stderr);
  if (authErrorClass) {
    await runner.abortMergeBestEffort(repoPath);
    return authErrorResult(
      sourceBranch,
      destinationBranch,
      stderr.trim() || (error as Error).message,
      authErrorClass,
    );
  }

  const conflictedFiles = await runner.getConflictedFiles(repoPath);
  await runner.abortMergeBestEffort(repoPath);
  if (isMergeConflict(stderr) || conflictedFiles.length > 0) {
    return conflictResult(sourceBranch, destinationBranch, conflictedFiles);
  }
  return failedResult(
    sourceBranch,
    destinationBranch,
    describeNonConflictFailure(stderr, error),
  );
}
