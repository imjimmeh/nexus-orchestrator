import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import { GitCommandService } from '../git-command/git-command.service';
import { ErrorEnvelope } from '@nexus/core';
import { GitWorktreeEntry } from './worktree.types';

/** Patterns in git stderr that indicate the worktree is locked and needs -f -f. */
const WORKTREE_LOCK_PATTERNS = [
  'locked working tree',
  '--force --force',
  'is locked',
] as const;

const INVALID_WORKTREE_GITDIR_PATTERNS = [
  'validation failed, cannot remove working tree',
  'is not a .git file',
] as const;

function isLockedWorktreeError(message: string): boolean {
  const lower = message.toLowerCase();
  return WORKTREE_LOCK_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isInvalidWorktreeGitdirError(message: string): boolean {
  const lower = message.toLowerCase();
  return INVALID_WORKTREE_GITDIR_PATTERNS.some((pattern) =>
    lower.includes(pattern),
  );
}

function applyPorcelainLine(current: GitWorktreeEntry, line: string): void {
  if (line.startsWith('HEAD ')) {
    current.head = line.slice('HEAD '.length).trim();
  } else if (line.startsWith('branch ')) {
    const fullRef = line.slice('branch '.length).trim();
    current.branch = fullRef.replace('refs/heads/', '');
  } else if (line.startsWith('locked')) {
    current.locked =
      line.length > 'locked'.length ? line.slice('locked '.length).trim() : '';
  }
}

@Injectable()
export class WorktreeOperationsService {
  constructor(private readonly gitCommand: GitCommandService) {}

  async listWorktrees(repoPath: string): Promise<GitWorktreeEntry[]> {
    const lines = await this.gitCommand.execLines(repoPath, [
      'worktree',
      'list',
      '--porcelain',
    ]);
    const entries: GitWorktreeEntry[] = [];

    let current: GitWorktreeEntry | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current) {
          entries.push(current);
        }

        current = {
          path: path.resolve(line.slice('worktree '.length).trim()),
        };
        continue;
      }

      if (current) {
        applyPorcelainLine(current, line);
      }
    }

    if (current) {
      entries.push(current);
    }

    return entries;
  }

  async findWorktreeByPath(
    repoPath: string,
    worktreePath: string,
  ): Promise<GitWorktreeEntry | undefined> {
    const resolved = path.resolve(worktreePath);
    const worktrees = await this.listWorktrees(repoPath);
    return worktrees.find((entry) => path.resolve(entry.path) === resolved);
  }

  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    options?: { createBranch?: boolean; baseRef?: string },
  ): Promise<void> {
    const args = ['worktree', 'add'];

    if (options?.createBranch) {
      args.push('-b', branch);
    }

    args.push(worktreePath);

    if (!options?.createBranch) {
      args.push(branch);
    }

    if (options?.baseRef && options.createBranch) {
      args.push(options.baseRef);
    }

    await this.gitCommand.exec(repoPath, args);
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await this.gitCommand.exec(repoPath, [
        'worktree',
        'remove',
        '--force',
        worktreePath,
      ]);
    } catch (firstError) {
      const firstMessage =
        firstError instanceof Error ? firstError.message : String(firstError);

      if (isInvalidWorktreeGitdirError(firstMessage)) {
        throw Object.assign(new Error('worktree.gitdir-invalid'), {
          kind: 'worktree.gitdir-invalid',
          path: worktreePath,
          hint: firstMessage,
        } satisfies ErrorEnvelope);
      }

      if (!isLockedWorktreeError(firstMessage)) {
        throw firstError;
      }

      // Locked worktree: attempt double-force remove.
      try {
        await this.gitCommand.exec(repoPath, [
          'worktree',
          'remove',
          '--force',
          '--force',
          worktreePath,
        ]);
      } catch (secondError) {
        const secondMessage =
          secondError instanceof Error
            ? secondError.message
            : String(secondError);
        throw Object.assign(new Error('worktree.lock'), {
          kind: 'worktree.lock',
          path: worktreePath,
          hint: secondMessage,
        } satisfies ErrorEnvelope);
      }
    }
  }

  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.gitCommand.exec(repoPath, ['worktree', 'prune']);
  }
}
