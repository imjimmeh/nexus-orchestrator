import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InternalServerErrorException } from '@nestjs/common';
import type { GitCommandService } from '../git-command/git-command.service';
import { BranchOperationsService } from './branch-operations.service';
import { isErrorEnvelope } from '@nexus/core';

describe('BranchOperationsService', () => {
  let service: BranchOperationsService;
  const execMock = vi.fn();
  const gitCommand = {
    exec: execMock,
    execLines: vi.fn(),
  } as unknown as GitCommandService;

  beforeEach(() => {
    service = new BranchOperationsService(gitCommand);
    service.skipFetchInTests = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveDefaultBranch', () => {
    const REPO = '/repo';

    it('returns hint directly when the local branch exists', async () => {
      execMock.mockResolvedValue({ stdout: '', stderr: '' }); // show-ref succeeds
      const result = await service.resolveDefaultBranch(REPO, 'develop');
      expect(result).toBe('develop');
    });

    it('returns hint when it exists only on the remote', async () => {
      // First call: local refs/heads/develop fails
      execMock
        .mockRejectedValueOnce(new InternalServerErrorException('not found'))
        // Second call: refs/remotes/origin/develop exists
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.resolveDefaultBranch(REPO, 'develop');
      expect(result).toBe('develop');
    });

    it('falls back to origin/HEAD when no hint provided', async () => {
      // show-ref origin/HEAD returns refs/remotes/origin/main
      execMock.mockResolvedValue({
        stdout: 'refs/remotes/origin/main\n',
        stderr: '',
      });

      const result = await service.resolveDefaultBranch(REPO);
      expect(result).toBe('main');
    });

    it('falls back to local HEAD when origin/HEAD is not set', async () => {
      execMock
        // symbolic-ref refs/remotes/origin/HEAD fails
        .mockRejectedValueOnce(
          new InternalServerErrorException('no origin HEAD'),
        )
        // symbolic-ref --short HEAD returns 'trunk'
        .mockResolvedValueOnce({ stdout: 'trunk\n', stderr: '' });

      const result = await service.resolveDefaultBranch(REPO);
      expect(result).toBe('trunk');
    });

    it('throws worktree.branch-missing ErrorEnvelope when all strategies fail', async () => {
      execMock.mockRejectedValue(
        new InternalServerErrorException('ref not found'),
      );

      await expect(service.resolveDefaultBranch(REPO)).rejects.toSatisfy(
        (e: unknown) =>
          isErrorEnvelope(e) &&
          (e as { kind: string }).kind === 'worktree.branch-missing',
      );
    });

    it('throws worktree.branch-missing when hint does not resolve anywhere', async () => {
      execMock.mockRejectedValue(
        new InternalServerErrorException('ref not found'),
      );

      await expect(
        service.resolveDefaultBranch(REPO, 'non-existent'),
      ).rejects.toSatisfy(
        (e: unknown) =>
          isErrorEnvelope(e) &&
          (e as { kind: string }).kind === 'worktree.branch-missing',
      );
    });

    it('strips refs/remotes/origin/ prefix from symbolic-ref output', async () => {
      execMock.mockResolvedValue({
        stdout: 'refs/remotes/origin/master\n',
        stderr: '',
      });

      const result = await service.resolveDefaultBranch(REPO);
      expect(result).toBe('master');
    });

    it('runs git fetch origin if skipFetchInTests is false and origin exists', async () => {
      service.skipFetchInTests = false;

      // hasOriginRemote: git remote get-url origin
      execMock.mockResolvedValueOnce({
        stdout: 'https://github.com/org/repo.git\n',
        stderr: '',
      });
      // fetchRemoteBestEffort: git fetch origin
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // resolveDefaultBranch: symbolic-ref refs/remotes/origin/HEAD
      execMock.mockResolvedValueOnce({
        stdout: 'refs/remotes/origin/main\n',
        stderr: '',
      });

      const result = await service.resolveDefaultBranch(REPO);
      expect(result).toBe('main');

      expect(execMock).toHaveBeenNthCalledWith(1, REPO, [
        'remote',
        'get-url',
        'origin',
      ]);
      expect(execMock).toHaveBeenNthCalledWith(2, REPO, ['fetch', 'origin']);
    });
  });

  describe('resolveBaseRef', () => {
    const REPO = '/repo';

    it('prefers the freshly fetched origin/<base> over a stale local branch', async () => {
      // After fetch (skipped in tests), the remote ref check succeeds first.
      // refs/remotes/origin/main exists.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.resolveBaseRef(REPO, 'main');

      expect(result).toBe('origin/main');
      expect(execMock).toHaveBeenNthCalledWith(1, REPO, [
        'show-ref',
        '--verify',
        '--quiet',
        'refs/remotes/origin/main',
      ]);
    });

    it('falls back to the local branch when origin has no such ref (local-only repo)', async () => {
      execMock
        // refs/remotes/origin/main missing
        .mockRejectedValueOnce(
          new InternalServerErrorException('no remote ref'),
        )
        // refs/heads/main exists
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.resolveBaseRef(REPO, 'main');

      expect(result).toBe('main');
    });

    it('throws when the base branch exists neither on origin nor locally', async () => {
      execMock.mockRejectedValue(
        new InternalServerErrorException('ref not found'),
      );

      await expect(service.resolveBaseRef(REPO, 'main')).rejects.toThrow(
        /does not exist locally or on origin/,
      );
    });

    it('fetches origin before resolving when fetch is enabled', async () => {
      service.skipFetchInTests = false;

      // hasOriginRemote: git remote get-url origin
      execMock.mockResolvedValueOnce({
        stdout: 'https://github.com/org/repo.git\n',
        stderr: '',
      });
      // fetchRemoteBestEffort: git fetch origin
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // refs/remotes/origin/main exists
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.resolveBaseRef(REPO, 'main');

      expect(result).toBe('origin/main');
      expect(execMock).toHaveBeenNthCalledWith(2, REPO, ['fetch', 'origin']);
    });
  });

  describe('createBranch', () => {
    const REPO = '/repo';

    it('cuts from origin/<base> when an explicit base branch is provided', async () => {
      // resolveBaseRef: refs/remotes/origin/main exists.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // checkout -b.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.createBranch(REPO, 'feature/x', 'main');

      expect(execMock).toHaveBeenLastCalledWith(REPO, [
        'checkout',
        '-b',
        'feature/x',
        'origin/main',
      ]);
    });

    it('cuts from origin/<default> (never the stale local branch) when no base is provided', async () => {
      // resolveDefaultBranch: symbolic-ref refs/remotes/origin/HEAD -> main.
      execMock.mockResolvedValueOnce({
        stdout: 'refs/remotes/origin/main\n',
        stderr: '',
      });
      // resolveBaseRef: refs/remotes/origin/main exists.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
      // checkout -b.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.createBranch(REPO, 'feature/x');

      expect(execMock).toHaveBeenLastCalledWith(REPO, [
        'checkout',
        '-b',
        'feature/x',
        'origin/main',
      ]);
    });

    it('falls back to the local default branch for repos without an origin ref', async () => {
      // resolveDefaultBranch: origin/HEAD missing, local HEAD -> main.
      execMock
        .mockRejectedValueOnce(new InternalServerErrorException('no origin'))
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });
      // resolveBaseRef: origin/main missing, local refs/heads/main exists.
      execMock
        .mockRejectedValueOnce(new InternalServerErrorException('no remote'))
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
      // checkout -b.
      execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.createBranch(REPO, 'feature/x');

      expect(execMock).toHaveBeenLastCalledWith(REPO, [
        'checkout',
        '-b',
        'feature/x',
        'main',
      ]);
    });
  });

  describe('fastForwardBranchToBase', () => {
    const REPO = '/repo';

    it('reports up-to-date and makes no changes when the branch equals the base', async () => {
      execMock
        .mockResolvedValueOnce({ stdout: 'sha-same\n', stderr: '' }) // rev-parse branch
        .mockResolvedValueOnce({ stdout: 'sha-same\n', stderr: '' }); // rev-parse base

      const result = await service.fastForwardBranchToBase(
        REPO,
        'feature/x',
        'origin/main',
      );

      expect(result).toBe('up-to-date');
      expect(execMock).not.toHaveBeenCalledWith(REPO, [
        'branch',
        '-f',
        'feature/x',
        'origin/main',
      ]);
    });

    it('fast-forwards when the branch is a clean ancestor of the base', async () => {
      execMock
        .mockResolvedValueOnce({ stdout: 'sha-branch\n', stderr: '' }) // rev-parse branch
        .mockResolvedValueOnce({ stdout: 'sha-base\n', stderr: '' }) // rev-parse base
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // merge-base --is-ancestor (success)
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // branch -f

      const result = await service.fastForwardBranchToBase(
        REPO,
        'feature/x',
        'origin/main',
      );

      expect(result).toBe('fast-forwarded');
      expect(execMock).toHaveBeenLastCalledWith(REPO, [
        'branch',
        '-f',
        'feature/x',
        'origin/main',
      ]);
    });

    it('preserves the branch when it has diverged from the base', async () => {
      execMock
        .mockResolvedValueOnce({ stdout: 'sha-branch\n', stderr: '' }) // rev-parse branch
        .mockResolvedValueOnce({ stdout: 'sha-base\n', stderr: '' }) // rev-parse base
        .mockRejectedValueOnce(
          new InternalServerErrorException('not an ancestor'),
        ); // merge-base --is-ancestor (fails)

      const result = await service.fastForwardBranchToBase(
        REPO,
        'feature/x',
        'origin/main',
      );

      expect(result).toBe('preserved');
      expect(execMock).not.toHaveBeenCalledWith(REPO, [
        'branch',
        '-f',
        'feature/x',
        'origin/main',
      ]);
    });

    it('preserves the branch when a ref cannot be resolved', async () => {
      execMock
        .mockRejectedValueOnce(new InternalServerErrorException('no branch')) // rev-parse branch
        .mockResolvedValueOnce({ stdout: 'sha-base\n', stderr: '' }); // rev-parse base

      const result = await service.fastForwardBranchToBase(
        REPO,
        'feature/x',
        'origin/main',
      );

      expect(result).toBe('preserved');
    });
  });

  describe('syncDefaultBranchToOrigin', () => {
    const REPO = '/repo';

    /**
     * Route exec calls by their git subcommand so the multi-step method can be
     * exercised without brittle call-order coupling.
     */
    function routeExec(handlers: {
      remote?: () => unknown;
      defaultBranch?: string | null;
      localSha?: string | null;
      originSha?: string | null;
      isAncestor?: boolean;
      currentBranch?: string | null;
      ffShouldFail?: boolean;
    }): void {
      execMock.mockImplementation(
        (_repo: string, args: string[]): Promise<unknown> => {
          const cmd = args.join(' ');
          if (cmd === 'remote get-url origin') {
            if (handlers.remote) return Promise.resolve(handlers.remote());
            return Promise.resolve({ stdout: 'url\n', stderr: '' });
          }
          if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
            return handlers.defaultBranch
              ? Promise.resolve({
                  stdout: `refs/remotes/origin/${handlers.defaultBranch}\n`,
                  stderr: '',
                })
              : Promise.reject(new InternalServerErrorException('no head'));
          }
          if (cmd === 'symbolic-ref --short HEAD') {
            return handlers.currentBranch
              ? Promise.resolve({
                  stdout: `${handlers.currentBranch}\n`,
                  stderr: '',
                })
              : Promise.reject(new InternalServerErrorException('detached'));
          }
          if (args[0] === 'rev-parse') {
            const ref = args[args.length - 1];
            const sha = ref.startsWith('origin/')
              ? handlers.originSha
              : handlers.localSha;
            return sha
              ? Promise.resolve({ stdout: `${sha}\n`, stderr: '' })
              : Promise.reject(new InternalServerErrorException('bad ref'));
          }
          if (cmd.startsWith('merge-base --is-ancestor')) {
            return handlers.isAncestor
              ? Promise.resolve({ stdout: '', stderr: '' })
              : Promise.reject(
                  new InternalServerErrorException('not ancestor'),
                );
          }
          if (args[0] === 'merge' || args[0] === 'branch') {
            return handlers.ffShouldFail
              ? Promise.reject(new InternalServerErrorException('dirty tree'))
              : Promise.resolve({ stdout: '', stderr: '' });
          }
          return Promise.resolve({ stdout: '', stderr: '' });
        },
      );
    }

    it('reports no-remote when the clone has no origin', async () => {
      routeExec({ remote: () => Promise.reject(new Error('no remote')) });
      execMock.mockImplementation((_repo: string, args: string[]) =>
        args.join(' ') === 'remote get-url origin'
          ? Promise.reject(new InternalServerErrorException('no remote'))
          : Promise.resolve({ stdout: '', stderr: '' }),
      );

      const result = await service.syncDefaultBranchToOrigin(REPO);

      expect(result).toEqual({ status: 'no-remote', branch: null });
    });

    it('reports already-current when local default equals origin', async () => {
      routeExec({
        defaultBranch: 'main',
        localSha: 'sha-x',
        originSha: 'sha-x',
      });

      const result = await service.syncDefaultBranchToOrigin(REPO);

      expect(result).toEqual({ status: 'already-current', branch: 'main' });
    });

    it('fast-forwards the checked-out default branch via merge --ff-only', async () => {
      routeExec({
        defaultBranch: 'main',
        localSha: 'sha-local',
        originSha: 'sha-origin',
        isAncestor: true,
        currentBranch: 'main',
      });

      const result = await service.syncDefaultBranchToOrigin(REPO);

      expect(result).toEqual({ status: 'fast-forwarded', branch: 'main' });
      expect(execMock).toHaveBeenCalledWith(REPO, [
        'merge',
        '--ff-only',
        'origin/main',
      ]);
    });

    it('leaves a diverged local default branch untouched', async () => {
      routeExec({
        defaultBranch: 'main',
        localSha: 'sha-local',
        originSha: 'sha-origin',
        isAncestor: false,
      });

      const result = await service.syncDefaultBranchToOrigin(REPO);

      expect(result).toEqual({ status: 'diverged', branch: 'main' });
      expect(execMock).not.toHaveBeenCalledWith(REPO, [
        'merge',
        '--ff-only',
        'origin/main',
      ]);
    });

    it('skips when the fast-forward fails (e.g. dirty working tree)', async () => {
      routeExec({
        defaultBranch: 'main',
        localSha: 'sha-local',
        originSha: 'sha-origin',
        isAncestor: true,
        currentBranch: 'main',
        ffShouldFail: true,
      });

      const result = await service.syncDefaultBranchToOrigin(REPO);

      expect(result).toEqual({ status: 'skipped', branch: 'main' });
    });
  });
});
