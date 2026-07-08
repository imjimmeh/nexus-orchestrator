import { BadRequestException, Injectable } from '@nestjs/common';
import { ErrorEnvelope } from '@nexus/core';
import { GitCommandService } from '../git-command/git-command.service';
import type { DefaultBranchSyncResult } from './branch-operations.service.types';

@Injectable()
export class BranchOperationsService {
  public skipFetchInTests = false;

  constructor(private readonly gitCommand: GitCommandService) {}

  async hasLocalBranch(repoPath: string, branchName: string): Promise<boolean> {
    return this.hasRef(repoPath, `refs/heads/${branchName}`);
  }

  async hasRef(repoPath: string, refName: string): Promise<boolean> {
    try {
      await this.gitCommand.exec(repoPath, [
        'show-ref',
        '--verify',
        '--quiet',
        refName,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async fetchRemoteBestEffort(repoPath: string): Promise<void> {
    if (this.skipFetchInTests) return;
    const hasRemote = await this.hasOriginRemote(repoPath);
    if (!hasRemote) return;
    try {
      await this.gitCommand.exec(repoPath, ['fetch', 'origin']);
    } catch {
      // Best effort ignore
    }
  }

  /**
   * Resolve the ref a new branch should be cut from.
   *
   * Prefers the freshly fetched `origin/<baseBranch>` over the persistent
   * clone's local branch of the same name. The local default branch is never
   * pulled, so reusing it would cut feature branches from a stale base and
   * cause avoidable merge conflicts. The local branch is only used as a
   * fallback for repositories without an `origin` remote (e.g. local-only
   * dev or test fixtures).
   */
  async resolveBaseRef(repoPath: string, baseBranch: string): Promise<string> {
    await this.fetchRemoteBestEffort(repoPath);
    if (await this.hasRef(repoPath, `refs/remotes/origin/${baseBranch}`)) {
      return `origin/${baseBranch}`;
    }

    if (await this.hasRef(repoPath, `refs/heads/${baseBranch}`)) {
      return baseBranch;
    }

    throw new BadRequestException(
      `Base branch ${baseBranch} does not exist locally or on origin`,
    );
  }

  /**
   * Infer the repository's default branch without relying on a hard-coded name.
   *
   * Resolution order:
   * 1. `hint` — if provided and the local ref exists, return it directly.
   * 2. `git symbolic-ref refs/remotes/origin/HEAD` — strips the
   *    `refs/remotes/origin/` prefix to get the remote default branch.
   * 3. `git symbolic-ref HEAD` — returns the local HEAD branch name.
   *
   * Throws `ErrorEnvelope { kind: 'worktree.branch-missing' }` only if all
   * three strategies fail.
   */
  async resolveDefaultBranch(repoPath: string, hint?: string): Promise<string> {
    await this.fetchRemoteBestEffort(repoPath);
    // 1. Caller-supplied hint.
    if (hint && hint.trim().length > 0) {
      const trimmed = hint.trim();
      if (await this.hasLocalBranch(repoPath, trimmed)) {
        return trimmed;
      }
      if (await this.hasRef(repoPath, `refs/remotes/origin/${trimmed}`)) {
        return trimmed;
      }
    }

    // 2. Origin symbolic HEAD.
    try {
      const result = await this.gitCommand.exec(repoPath, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
      ]);
      const ref = result.stdout.trim();
      const PREFIX = 'refs/remotes/origin/';
      if (ref.startsWith(PREFIX)) {
        return ref.slice(PREFIX.length);
      }
    } catch {
      // origin/HEAD not set — fall through.
    }

    // 3. Local HEAD branch.
    try {
      const result = await this.gitCommand.exec(repoPath, [
        'symbolic-ref',
        '--short',
        'HEAD',
      ]);
      const branch = result.stdout.trim();
      if (branch.length > 0) {
        return branch;
      }
    } catch {
      // Detached HEAD or bare repo — fall through.
    }

    // All strategies exhausted.
    throw Object.assign(new Error('worktree.branch-missing'), {
      kind: 'worktree.branch-missing',
      branch: hint ?? '(none)',
      remote: 'origin',
    } satisfies ErrorEnvelope);
  }

  /**
   * Bring an existing local branch up to a base ref when — and only when — it
   * can be cleanly fast-forwarded (the branch carries no unique commits of its
   * own). This refreshes stale empty branch pointers without ever discarding
   * real work.
   *
   * Returns:
   * - `up-to-date`     — the branch already points at the base.
   * - `fast-forwarded` — the branch was advanced to the base.
   * - `preserved`      — the branch has diverged/unique commits and was left
   *                       untouched (caller should surface the staleness).
   */
  async fastForwardBranchToBase(
    repoPath: string,
    branchName: string,
    baseRef: string,
  ): Promise<'up-to-date' | 'fast-forwarded' | 'preserved'> {
    const [branchSha, baseSha] = await Promise.all([
      this.revParseQuiet(repoPath, branchName),
      this.revParseQuiet(repoPath, baseRef),
    ]);
    if (!branchSha || !baseSha) {
      return 'preserved';
    }
    if (branchSha === baseSha) {
      return 'up-to-date';
    }
    const branchIsAncestorOfBase = await this.isAncestor(
      repoPath,
      branchName,
      baseRef,
    );
    if (!branchIsAncestorOfBase) {
      return 'preserved';
    }
    await this.gitCommand.exec(repoPath, ['branch', '-f', branchName, baseRef]);
    return 'fast-forwarded';
  }

  private async revParseQuiet(
    repoPath: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const result = await this.gitCommand.exec(repoPath, [
        'rev-parse',
        '--verify',
        '--quiet',
        ref,
      ]);
      const sha = result.stdout.trim();
      return sha.length > 0 ? sha : null;
    } catch {
      return null;
    }
  }

  private async isAncestor(
    repoPath: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    try {
      await this.gitCommand.exec(repoPath, [
        'merge-base',
        '--is-ancestor',
        ancestor,
        descendant,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Keep a clone's local default branch in lock-step with `origin` by
   * fast-forwarding it to `origin/<default>` whenever it is safe to do so.
   *
   * This is the systemic backstop against clones whose local default branch
   * drifts from origin (e.g. a workflow that commits artifacts onto the shared
   * checkout). It never discards local commits: a branch that is ahead of or
   * has diverged from origin is reported as `diverged` and left untouched for
   * an operator to resolve.
   */
  async syncDefaultBranchToOrigin(
    repoPath: string,
  ): Promise<DefaultBranchSyncResult> {
    await this.fetchRemoteBestEffort(repoPath);

    if (!(await this.hasOriginRemote(repoPath))) {
      return { status: 'no-remote', branch: null };
    }

    let branch: string;
    try {
      branch = await this.resolveDefaultBranch(repoPath);
    } catch {
      return { status: 'skipped', branch: null };
    }

    const originRef = `origin/${branch}`;
    const [localSha, originSha] = await Promise.all([
      this.revParseQuiet(repoPath, branch),
      this.revParseQuiet(repoPath, originRef),
    ]);
    if (!localSha || !originSha) {
      return { status: 'skipped', branch };
    }
    if (localSha === originSha) {
      return { status: 'already-current', branch };
    }

    const canFastForward = await this.isAncestor(repoPath, branch, originRef);
    if (!canFastForward) {
      return { status: 'diverged', branch };
    }

    try {
      const currentBranch = await this.currentBranch(repoPath);
      if (currentBranch === branch) {
        // The default branch is the checked-out working tree — advance it in
        // place, which also refuses if the tree is dirty.
        await this.gitCommand.exec(repoPath, ['merge', '--ff-only', originRef]);
      } else {
        await this.gitCommand.exec(repoPath, [
          'branch',
          '-f',
          branch,
          originRef,
        ]);
      }
      return { status: 'fast-forwarded', branch };
    } catch {
      return { status: 'skipped', branch };
    }
  }

  private async currentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = await this.gitCommand.exec(repoPath, [
        'symbolic-ref',
        '--short',
        'HEAD',
      ]);
      const branch = result.stdout.trim();
      return branch.length > 0 ? branch : null;
    } catch {
      return null;
    }
  }

  async hasOriginRemote(repoPath: string): Promise<boolean> {
    try {
      await this.gitCommand.exec(repoPath, ['remote', 'get-url', 'origin']);
      return true;
    } catch {
      return false;
    }
  }

  async pushBranch(repoPath: string, branchName: string): Promise<boolean> {
    const hasRemote = await this.hasOriginRemote(repoPath);
    if (!hasRemote) {
      return false;
    }

    try {
      await this.gitCommand.exec(repoPath, [
        'push',
        '--set-upstream',
        'origin',
        branchName,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    baseRef?: string,
  ): Promise<void> {
    // Always resolve through `resolveBaseRef` so the branch is cut from the
    // freshly fetched `origin/<base>` rather than a stale, unpulled local
    // branch. When no base is supplied, the repository's default branch name
    // is inferred first, then qualified against origin the same way.
    const baseBranchName =
      baseRef ?? (await this.resolveDefaultBranch(repoPath));
    const resolvedBaseRef = await this.resolveBaseRef(repoPath, baseBranchName);

    await this.gitCommand.exec(repoPath, [
      'checkout',
      '-b',
      branchName,
      resolvedBaseRef,
    ]);
  }
}
