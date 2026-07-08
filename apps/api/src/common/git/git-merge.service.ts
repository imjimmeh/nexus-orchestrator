import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, rename } from 'node:fs/promises';
import * as path from 'node:path';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { GitAuthEnvResolverService } from './git-auth-env-resolver.service';
import { resolveGitRepositoryPath } from './git-repository-path-candidates.util';
import type {
  AuthErrorClass,
  GitCaptureResult,
  MergeResult,
} from './git-merge.service.types';
import {
  authErrorResult,
  classifyAuthError,
  conflictResult,
  describeNonConflictFailure,
  emitMergeOutcome,
  emitMergeRequested,
  emitWorktreeCleaned,
  extractMergeError,
  failedResult,
  isMergeConflict,
  parseGitLines,
  runGitCapturing,
  runGitOrThrow,
  sharedCloneCleanResult,
  sharedCloneDirtyResult,
  worktreePreparedResult,
} from './git-merge.helpers';
import { integrateIntoBase } from './git-merge-integration.helpers';
import {
  parsePorcelainEntries,
  reconcileSharedCloneBlockers,
} from './git-shared-clone-reconcile.helpers';

export type { MergeOutcome, MergeResult } from './git-merge.service.types';

type GitAuthEnv = Record<string, string>;

/** Internal phase result for the in-worktree merge preparation. */
type WorktreePrep = { kind: 'ready' } | { kind: 'result'; result: MergeResult };

/**
 * Performs a context merge in two stages that each use a single working tree:
 *
 *  1. **Worktree stage** — the base branch is merged INTO the context's own
 *     worktree (which is checked out to the feature branch). Conflicts are left
 *     in place so a conflict-resolution agent operating in that same worktree
 *     sees real markers. The stage is idempotent: a second call detects an
 *     in-progress or already-completed merge instead of replaying it.
 *
 *  2. **Integration stage** — once the worktree is clean and the feature branch
 *     contains the base, the shared clone root is reset to `origin/<base>` (so a
 *     stale local base or a dirty working tree can never block or distort the
 *     merge) and the resolved feature branch is merged into the base and pushed.
 */
@Injectable()
export class GitMergeService {
  readonly logger = new Logger(GitMergeService.name);

  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly authEnvResolver: GitAuthEnvResolverService,
  ) {}

  async mergeWithConflictDetection(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
    worktreePath: string,
  ): Promise<MergeResult> {
    const cloneRoot = await this.resolveGitRepoPath(scopeId);
    if (!cloneRoot) {
      throw new BadRequestException(
        `Repository path is not a git repository: ${scopeId}`,
      );
    }

    return this.executeMergePhase(
      scopeId,
      sourceBranch,
      destinationBranch,
      async (authEnv) => {
        const prep = await this.prepareWorktreeMerge(
          scopeId,
          worktreePath,
          sourceBranch,
          destinationBranch,
          authEnv,
        );
        return prep.kind === 'result'
          ? prep.result
          : integrateIntoBase(
              this,
              cloneRoot,
              sourceBranch,
              destinationBranch,
              authEnv,
            );
      },
    );
  }

  /**
   * Stage 1 (public): merge the base branch into the context worktree only.
   * Never pushes and never touches the shared clone root, so the resulting tree
   * is exactly what a downstream quality gate validates in that same worktree.
   * Returns `succeeded` (worktree ready), `conflict`, `auth_error`, or `failed`.
   */
  async prepareMergeInWorktree(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
    worktreePath: string,
  ): Promise<MergeResult> {
    return this.executeMergePhase(
      scopeId,
      sourceBranch,
      destinationBranch,
      async (authEnv) => {
        const prep = await this.prepareWorktreeMerge(
          scopeId,
          worktreePath,
          sourceBranch,
          destinationBranch,
          authEnv,
        );
        return prep.kind === 'result'
          ? prep.result
          : worktreePreparedResult(sourceBranch, destinationBranch);
      },
    );
  }

  /**
   * Stage 2 (public): integrate the resolved feature branch into the base inside
   * the shared clone root and push hook-free. Resolves the clone root from the
   * scope; returns `succeeded`, `auth_error`, or `failed`.
   */
  async integrateAndPush(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
  ): Promise<MergeResult> {
    const cloneRoot = await this.resolveGitRepoPath(scopeId);
    if (!cloneRoot) {
      return failedResult(
        sourceBranch,
        destinationBranch,
        `Repository path is not a git repository: ${scopeId}`,
      );
    }

    return this.executeMergePhase(
      scopeId,
      sourceBranch,
      destinationBranch,
      (authEnv) =>
        integrateIntoBase(
          this,
          cloneRoot,
          sourceBranch,
          destinationBranch,
          authEnv,
        ),
    );
  }

  /**
   * Preflight the shared clone before direct integration. This reports state that
   * would make `git merge <source>` unsafe without deleting or resetting files.
   */
  async preflightSharedCloneIntegration(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
  ): Promise<MergeResult> {
    try {
      const [cloneRoot, sourceTrackedPaths, authEnv] =
        await this.resolveSourceContext(scopeId, sourceBranch);
      const dirtyPaths = await this.listSharedCloneIntegrationBlockers(
        cloneRoot,
        sourceTrackedPaths,
        authEnv,
      );
      return dirtyPaths.length === 0
        ? sharedCloneCleanResult(sourceBranch, destinationBranch, cloneRoot)
        : sharedCloneDirtyResult(
            sourceBranch,
            destinationBranch,
            cloneRoot,
            dirtyPaths,
          );
    } catch (error) {
      return failedResult(
        sourceBranch,
        destinationBranch,
        (error as Error).message,
      );
    }
  }

  /**
   * Deterministically reconcile the provably-safe shared-clone blockers before
   * falling back to agent remediation: restore tracked deletions from HEAD and
   * quarantine untracked files the source branch already tracks.
   */
  async reconcileSharedCloneIntegration(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
  ): Promise<MergeResult> {
    try {
      const [cloneRoot, sourceTrackedPaths, authEnv] =
        await this.resolveSourceContext(scopeId, sourceBranch);
      return await reconcileSharedCloneBlockers(
        this,
        cloneRoot,
        scopeId,
        sourceBranch,
        destinationBranch,
        sourceTrackedPaths,
        authEnv,
      );
    } catch (error) {
      return failedResult(
        sourceBranch,
        destinationBranch,
        (error as Error).message,
      );
    }
  }

  /** Clone root, source-branch tracked paths, and auth env shared by both entry points above. */
  private async resolveSourceContext(
    scopeId: string,
    sourceBranch: string,
  ): Promise<[string, Set<string>, GitAuthEnv]> {
    const cloneRoot = await this.resolveGitRepoPath(scopeId);
    if (!cloneRoot) {
      throw new Error(`Repository path is not a git repository: ${scopeId}`);
    }
    const authEnv =
      await this.authEnvResolver.resolveProjectGitAuthEnv(scopeId);
    const sourceTrackedPaths = await this.listTrackedPaths(
      cloneRoot,
      sourceBranch,
      authEnv,
    );
    return [cloneRoot, sourceTrackedPaths, authEnv];
  }

  /** Seam for quarantine moves so specs can intercept filesystem effects. */
  async moveFileWithDirs(from: string, to: string): Promise<void> {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }

  /**
   * Push the already-committed feature branch to origin hook-free. Used by the
   * pull-request integration strategy: the PR opens against the pushed head while
   * the base branch is never modified by the engine.
   */
  async pushFeatureBranch(scopeId: string, branch: string): Promise<void> {
    const cloneRoot = await this.resolveGitRepoPath(scopeId);
    if (!cloneRoot) {
      throw new BadRequestException(
        `Repository path is not a git repository: ${scopeId}`,
      );
    }
    const authEnv =
      await this.authEnvResolver.resolveProjectGitAuthEnv(scopeId);
    await this.runGit(
      cloneRoot,
      ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', branch],
      authEnv,
    );
  }

  /**
   * Resolve auth, emit `merge.requested`, run a merge phase, and emit the
   * outcome — turning any thrown error into a `failed` result. Shared by the
   * single-stage merge and the split prepare/integrate stages.
   */
  private async executeMergePhase(
    scopeId: string,
    sourceBranch: string,
    destinationBranch: string,
    phase: (authEnv: GitAuthEnv) => Promise<MergeResult>,
  ): Promise<MergeResult> {
    const authEnv =
      await this.authEnvResolver.resolveProjectGitAuthEnv(scopeId);

    await emitMergeRequested(
      this.eventLedger,
      scopeId,
      sourceBranch,
      destinationBranch,
    );

    try {
      const result = await phase(authEnv);
      await emitMergeOutcome(this.eventLedger, scopeId, result);
      return result;
    } catch (error) {
      const result = failedResult(
        sourceBranch,
        destinationBranch,
        (error as Error).message,
      );
      await emitMergeOutcome(this.eventLedger, scopeId, result, error);
      return result;
    }
  }

  /**
   * Stage 1: merge the base branch into the context worktree. Idempotent — a
   * conflicted or already-completed merge is recognised rather than restarted.
   */
  private async prepareWorktreeMerge(
    scopeId: string,
    worktreePath: string,
    sourceBranch: string,
    destinationBranch: string,
    authEnv: GitAuthEnv,
  ): Promise<WorktreePrep> {
    if (await this.hasMergeInProgress(worktreePath)) {
      const conflicted = await this.getConflictedFiles(worktreePath);
      if (conflicted.length > 0) {
        // Resolution is incomplete — leave the conflicts for the agent.
        return {
          kind: 'result',
          result: conflictResult(sourceBranch, destinationBranch, conflicted),
        };
      }
      // Resolution was staged but never committed — complete the merge commit.
      await this.runGit(worktreePath, ['commit', '--no-edit'], authEnv);
      return { kind: 'ready' };
    }

    await this.discardWorktreeScratch(scopeId, worktreePath, authEnv);

    const baseRef = await this.resolveWorktreeBaseRef(
      worktreePath,
      destinationBranch,
      authEnv,
    );
    if (baseRef.authError) {
      return {
        kind: 'result',
        result: authErrorResult(
          sourceBranch,
          destinationBranch,
          baseRef.authError.message,
          baseRef.authError.authErrorClass,
        ),
      };
    }

    if (await this.isAncestor(worktreePath, baseRef.ref, 'HEAD')) {
      // Feature branch already contains the base — nothing to merge.
      return { kind: 'ready' };
    }

    try {
      await this.runGit(
        worktreePath,
        ['merge', '--no-ff', '--no-edit', baseRef.ref],
        authEnv,
      );
    } catch (error) {
      return {
        kind: 'result',
        result: await this.classifyWorktreeMergeFailure(
          worktreePath,
          sourceBranch,
          destinationBranch,
          error,
        ),
      };
    }

    return { kind: 'ready' };
  }

  /**
   * Discard uncommitted/untracked scratch in the worktree before merging the
   * base. By the time a work item is ready to merge its deliverable is already
   * committed, so anything left in the working tree is contamination (agent
   * build output, test artifacts, or a reused worktree) that would otherwise
   * abort `git merge <base>` with "local changes would be overwritten". Only
   * runs when no merge is in progress (that state is handled by the caller and
   * must be preserved). `git clean -fd` honours `.gitignore`, so ignored
   * runtime files are left untouched.
   */
  private async discardWorktreeScratch(
    scopeId: string,
    worktreePath: string,
    authEnv: GitAuthEnv,
  ): Promise<void> {
    const { stdout } = await this.runGitCapture(
      worktreePath,
      ['status', '--porcelain'],
      authEnv,
    );
    const discardedPaths = parseGitLines(stdout);
    if (discardedPaths.length === 0) {
      return;
    }
    await this.runGit(worktreePath, ['reset', '--hard', 'HEAD'], authEnv);
    await this.runGit(worktreePath, ['clean', '-fd'], authEnv);
    await emitWorktreeCleaned(
      this.eventLedger,
      scopeId,
      worktreePath,
      discardedPaths,
    );
  }

  private async classifyWorktreeMergeFailure(
    worktreePath: string,
    sourceBranch: string,
    destinationBranch: string,
    error: unknown,
  ): Promise<MergeResult> {
    const stderr = extractMergeError(error);
    const authErrorClass = classifyAuthError(stderr);
    if (authErrorClass) {
      await this.abortMergeBestEffort(worktreePath);
      return authErrorResult(
        sourceBranch,
        destinationBranch,
        stderr.trim() || (error as Error).message,
        authErrorClass,
      );
    }

    const conflicted = await this.getConflictedFiles(worktreePath);
    if (isMergeConflict(stderr) || conflicted.length > 0) {
      // Preserve the conflicted worktree so the resolution agent can fix it.
      return conflictResult(sourceBranch, destinationBranch, conflicted);
    }

    await this.abortMergeBestEffort(worktreePath);
    return failedResult(
      sourceBranch,
      destinationBranch,
      describeNonConflictFailure(stderr, error),
    );
  }

  private async listTrackedPaths(
    repoPath: string,
    ref: string,
    authEnv: GitAuthEnv,
  ): Promise<Set<string>> {
    const { stdout } = await this.runGitCapture(
      repoPath,
      ['ls-tree', '-z', '-r', '--name-only', ref],
      authEnv,
    );
    return new Set(parseGitRecords(stdout));
  }

  private async listSharedCloneIntegrationBlockers(
    repoPath: string,
    sourceTrackedPaths: Set<string>,
    authEnv: GitAuthEnv,
  ): Promise<string[]> {
    const { stdout } = await this.runGitCapture(
      repoPath,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      authEnv,
    );
    const blockers = parsePorcelainEntries(stdout)
      .filter(
        ({ status, path }) => status !== '??' || sourceTrackedPaths.has(path),
      )
      .map(({ path }) => path);
    return [...new Set(blockers)];
  }

  /** Resolve the base ref to merge into the worktree, fetching origin first. */
  private async resolveWorktreeBaseRef(
    worktreePath: string,
    destinationBranch: string,
    authEnv: GitAuthEnv,
  ): Promise<{
    ref: string;
    authError?: { message: string; authErrorClass: AuthErrorClass };
  }> {
    try {
      await this.fetchOriginBranch(worktreePath, destinationBranch, authEnv);
    } catch (error) {
      const stderr = extractMergeError(error);
      const authErrorClass = classifyAuthError(stderr);
      if (authErrorClass) {
        return {
          ref: destinationBranch,
          authError: {
            message: stderr.trim() || (error as Error).message,
            authErrorClass,
          },
        };
      }
      this.logger.warn(
        `resolveWorktreeBaseRef: fetch of origin/${destinationBranch} failed; using local ref: ${(error as Error).message}`,
      );
    }

    const originRef = `origin/${destinationBranch}`;
    if (await this.refExists(worktreePath, originRef)) {
      return { ref: originRef };
    }
    return { ref: destinationBranch };
  }

  /** True when a git command exits 0 (used for boolean state probes). */
  private async gitSucceeds(
    repoPath: string,
    args: string[],
  ): Promise<boolean> {
    const { code } = await this.runGitCapture(repoPath, args);
    return code === 0;
  }

  private hasMergeInProgress(repoPath: string): Promise<boolean> {
    return this.gitSucceeds(repoPath, [
      'rev-parse',
      '-q',
      '--verify',
      'MERGE_HEAD',
    ]);
  }

  private isAncestor(
    repoPath: string,
    ref: string,
    descendant: string,
  ): Promise<boolean> {
    return this.gitSucceeds(repoPath, [
      'merge-base',
      '--is-ancestor',
      ref,
      descendant,
    ]);
  }

  refExists(repoPath: string, ref: string): Promise<boolean> {
    return this.gitSucceeds(repoPath, ['rev-parse', '-q', '--verify', ref]);
  }

  async getConflictedFiles(repoPath: string): Promise<string[]> {
    const { stdout } = await this.runGitCapture(repoPath, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ]);
    return parseGitLines(stdout);
  }

  async resolveGitRepoPath(basePath: string | null): Promise<string | null> {
    return resolveGitRepositoryPath(basePath);
  }

  async revParseHead(repoPath: string): Promise<string> {
    const { stdout } = await this.runGitCapture(repoPath, [
      'rev-parse',
      'HEAD',
    ]);
    return stdout.trim();
  }

  async fetchOriginBranch(
    repoPath: string,
    branchName: string,
    authEnv: GitAuthEnv,
  ): Promise<void> {
    await this.runGit(repoPath, ['fetch', 'origin', branchName], authEnv);
  }

  async abortMergeBestEffort(repoPath: string): Promise<void> {
    try {
      await this.runGit(repoPath, ['merge', '--abort']);
    } catch {
      // Best effort rollback.
    }
  }

  async runGit(
    repoPath: string,
    args: string[],
    authEnv?: GitAuthEnv,
  ): Promise<void> {
    await runGitOrThrow(repoPath, args, authEnv);
  }

  /** Run a git command, capturing its exit code/output instead of throwing. */
  async runGitCapture(
    repoPath: string,
    args: string[],
    authEnv?: GitAuthEnv,
  ): Promise<GitCaptureResult> {
    return runGitCapturing(repoPath, args, authEnv);
  }
}

function parseGitRecords(stdout: string): string[] {
  return stdout.split('\0').filter((record) => record.length > 0);
}
