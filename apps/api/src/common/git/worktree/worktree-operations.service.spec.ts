import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InternalServerErrorException } from '@nestjs/common';
import type { GitCommandService } from '../git-command/git-command.service';
import { WorktreeOperationsService } from './worktree-operations.service';
import { isErrorEnvelope } from '@nexus/core';

describe('WorktreeOperationsService', () => {
  const execMock = vi.fn();
  const execLinesMock = vi.fn();
  const gitCommand = {
    exec: execMock,
    execLines: execLinesMock,
  } as unknown as GitCommandService;

  const service = new WorktreeOperationsService(gitCommand);

  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    execLinesMock.mockResolvedValue([]);
  });

  it('adds existing branch worktree with path before branch', async () => {
    await service.addWorktree('/repo', '/worktrees/project-1/wi-1', 'main');

    expect(execMock).toHaveBeenCalledWith('/repo', [
      'worktree',
      'add',
      '/worktrees/project-1/wi-1',
      'main',
    ]);
  });

  it('adds new branch worktree with -b syntax and base ref', async () => {
    await service.addWorktree(
      '/repo',
      '/worktrees/project-1/wi-1',
      'feature/wi-1',
      {
        createBranch: true,
        baseRef: 'origin/main',
      },
    );

    expect(execMock).toHaveBeenCalledWith('/repo', [
      'worktree',
      'add',
      '-b',
      'feature/wi-1',
      '/worktrees/project-1/wi-1',
      'origin/main',
    ]);
  });

  it('parses HEAD, branch, and locked lines from porcelain output', async () => {
    execLinesMock.mockResolvedValue([
      'worktree /repo',
      'HEAD abc123def456abc123def456abc123def456abc1',
      'branch refs/heads/main',
      '',
      'worktree /worktrees/project-1/wi-1',
      'HEAD 0000000000000000000000000000000000000000',
      'locked initializing',
      '',
      'worktree /worktrees/project-1/wi-2',
      'HEAD deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'branch refs/heads/feature/wi-2',
    ]);

    const result = await service.listWorktrees('/repo');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      path: expect.stringContaining('repo'),
      head: 'abc123def456abc123def456abc123def456abc1',
      branch: 'main',
    });
    expect(result[1]).toEqual({
      path: expect.stringContaining('wi-1'),
      head: '0000000000000000000000000000000000000000',
      locked: 'initializing',
    });
    expect(result[2]).toEqual({
      path: expect.stringContaining('wi-2'),
      head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      branch: 'feature/wi-2',
    });
  });

  describe('removeWorktree', () => {
    const REPO = '/repo';
    const TREE = '/repo/worktrees/proj/ticket';

    it('removes with single --force when git succeeds on first attempt', async () => {
      await service.removeWorktree(REPO, TREE);

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock).toHaveBeenCalledWith(REPO, [
        'worktree',
        'remove',
        '--force',
        TREE,
      ]);
    });

    it('retries with --force --force when git stderr indicates a locked worktree', async () => {
      const lockedError = new InternalServerErrorException(
        'Git command failed: worktree remove (fatal: locked working tree at /repo/worktrees)',
      );
      execMock
        .mockRejectedValueOnce(lockedError)
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.removeWorktree(REPO, TREE);

      expect(execMock).toHaveBeenCalledTimes(2);
      expect(execMock).toHaveBeenNthCalledWith(2, REPO, [
        'worktree',
        'remove',
        '--force',
        '--force',
        TREE,
      ]);
    });

    it('throws a worktree.lock ErrorEnvelope if double-force also fails', async () => {
      const lockedError = new InternalServerErrorException(
        'Git command failed: worktree remove (fatal: locked working tree)',
      );
      execMock.mockRejectedValue(lockedError);

      await expect(service.removeWorktree(REPO, TREE)).rejects.toSatisfy(
        (e: unknown) =>
          isErrorEnvelope(e) &&
          (e as { kind: string }).kind === 'worktree.lock',
      );
    });

    it('rethrows non-lock errors without retrying', async () => {
      const otherError = new InternalServerErrorException(
        'Git command failed: worktree remove (fatal: not a git repository)',
      );
      execMock.mockRejectedValue(otherError);

      await expect(service.removeWorktree(REPO, TREE)).rejects.toBe(otherError);
      // Must NOT retry for non-lock errors.
      expect(execMock).toHaveBeenCalledOnce();
    });

    it('throws a worktree.gitdir-invalid ErrorEnvelope when git rejects non-gitfile .git', async () => {
      const invalidGitdirError = new InternalServerErrorException(
        "Git command failed: worktree remove (fatal: validation failed, cannot remove working tree: '/repo/worktrees/proj/ticket/.git' is not a .git file)",
      );
      execMock.mockRejectedValue(invalidGitdirError);

      await expect(service.removeWorktree(REPO, TREE)).rejects.toSatisfy(
        (e: unknown) =>
          isErrorEnvelope(e) &&
          (e as { kind: string }).kind === 'worktree.gitdir-invalid',
      );

      expect(execMock).toHaveBeenCalledOnce();
    });

    it('detects "use --force --force" hint phrase', async () => {
      const lockedError = new InternalServerErrorException(
        "Git command failed: (To remove it, use 'git worktree remove --force --force')",
      );
      execMock
        .mockRejectedValueOnce(lockedError)
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.removeWorktree(REPO, TREE);

      expect(execMock).toHaveBeenCalledTimes(2);
    });
  });
});
