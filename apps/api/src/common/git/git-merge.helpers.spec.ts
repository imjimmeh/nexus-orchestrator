import { describe, expect, it, vi } from 'vitest';
import {
  emitWorktreeCleaned,
  isPrePushHookFailure,
  worktreePreparedResult,
} from './git-merge.helpers';

describe('worktreePreparedResult', () => {
  it('builds a succeeded MergeResult with no conflicts and a clear message', () => {
    const result = worktreePreparedResult('feature/ctx-1', 'main');

    expect(result).toMatchObject({
      outcome: 'succeeded',
      sourceBranch: 'feature/ctx-1',
      destinationBranch: 'main',
      conflictedFiles: [],
    });
    expect(result.message).toMatch(/worktree/i);
  });
});

describe('emitWorktreeCleaned', () => {
  it('emits a git.merge.worktree_cleaned event recording the discarded paths', async () => {
    const emitBestEffort = vi.fn().mockResolvedValue(undefined);

    await emitWorktreeCleaned(
      { emitBestEffort } as never,
      'scope-1',
      '/worktrees/scope-1/ctx-1',
      ['M apps/a.ts', '?? apps/b.ts'],
    );

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'git',
        eventName: 'git.merge.worktree_cleaned',
        outcome: 'success',
        payload: expect.objectContaining({
          worktreePath: '/worktrees/scope-1/ctx-1',
          discardedPathCount: 2,
          discardedPaths: ['M apps/a.ts', '?? apps/b.ts'],
        }),
      }),
    );
  });
});

describe('isPrePushHookFailure', () => {
  it('returns true for a local pre-push hook decline', () => {
    const stderr = [
      'Pre-push: running lint across all workspaces...',
      'npm error Lifecycle script `lint` failed with error:',
      "error: failed to push some refs to 'https://github.com/org/repo'",
    ].join('\n');
    expect(isPrePushHookFailure(stderr)).toBe(true);
  });

  it('returns false for a remote non-fast-forward rejection', () => {
    const stderr = [
      '! [rejected]        main -> main (non-fast-forward)',
      "error: failed to push some refs to 'https://github.com/org/repo'",
      'hint: Updates were rejected because the tip of your current branch is behind',
    ].join('\n');
    expect(isPrePushHookFailure(stderr)).toBe(false);
  });

  it('returns false when there is no push-refs error at all', () => {
    expect(isPrePushHookFailure('fatal: some unrelated git error')).toBe(false);
  });
});
