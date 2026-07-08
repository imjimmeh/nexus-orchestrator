import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitCommitPathsService } from './git-commit-paths.service';

describe('GitCommitPathsService', () => {
  const gitCommand = {
    exec: vi.fn(),
  };

  const lockService = {
    runRepoExclusive: vi.fn(
      (_repoPath: string, callback: () => Promise<unknown>) => callback(),
    ),
  };

  const branchOps = {
    hasOriginRemote: vi.fn(),
    pushBranch: vi.fn(),
  };

  const service = new GitCommitPathsService(
    gitCommand as never,
    lockService as never,
    branchOps as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    lockService.runRepoExclusive.mockImplementation(
      (_repoPath: string, callback: () => Promise<unknown>) => callback(),
    );
  });

  it('returns clean without staging or committing when requested paths have no changes', async () => {
    gitCommand.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await service.commitPaths({
      repoPath: '/repo',
      paths: ['docs/project-context'],
      message: 'docs(discovery): persist imported repository investigation',
    });

    expect(result).toEqual({
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    });
    expect(gitCommand.exec).toHaveBeenCalledTimes(1);
    expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
      'status',
      '--porcelain',
      '--',
      'docs/project-context',
    ]);
  });

  it('sets repo-local git identity before staging changed paths', async () => {
    gitCommand.exec
      .mockResolvedValueOnce({
        stdout: ' M docs/project-context/ARCHITECTURE.md\n',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        stdout: 'docs/project-context/ARCHITECTURE.md\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '[main abc1234] test identity\n',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'abc1234567890\n', stderr: '' });

    const result = await service.commitPaths({
      repoPath: '/repo',
      paths: ['docs/project-context/ARCHITECTURE.md'],
      message: 'test identity',
    });

    expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
      'config',
      '--local',
      'user.name',
      'Nexus Orchestrator',
    ]);
    expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
      'config',
      '--local',
      'user.email',
      'nexus@localhost',
    ]);
    expect(result).toEqual({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/ARCHITECTURE.md'],
      commit_sha: 'abc1234567890',
    });
  });

  it('does not set git identity when paths are clean', async () => {
    gitCommand.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await service.commitPaths({
      repoPath: '/repo',
      paths: ['docs/project-context/ARCHITECTURE.md'],
      message: 'test identity',
    });

    expect(gitCommand.exec).not.toHaveBeenCalledWith('/repo', [
      'config',
      '--local',
      'user.name',
      'Nexus Orchestrator',
    ]);
    expect(gitCommand.exec).not.toHaveBeenCalledWith('/repo', [
      'config',
      '--local',
      'user.email',
      'nexus@localhost',
    ]);
  });

  it('stages only requested paths and returns commit metadata', async () => {
    gitCommand.exec
      .mockResolvedValueOnce({
        stdout: ' M docs/project-context/ARCHITECTURE.md\n',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        stdout: 'docs/project-context/ARCHITECTURE.md\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout:
          '[main abc1234] docs(discovery): persist imported repository investigation\n',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: 'abc1234567890\n', stderr: '' });

    const result = await service.commitPaths({
      repoPath: '/repo',
      paths: ['docs/project-context'],
      message: 'docs(discovery): persist imported repository investigation',
    });

    expect(gitCommand.exec).toHaveBeenNthCalledWith(2, '/repo', [
      'config',
      '--local',
      'user.name',
      'Nexus Orchestrator',
    ]);
    expect(gitCommand.exec).toHaveBeenNthCalledWith(3, '/repo', [
      'config',
      '--local',
      'user.email',
      'nexus@localhost',
    ]);
    expect(gitCommand.exec).toHaveBeenNthCalledWith(4, '/repo', [
      'add',
      '-A',
      '--',
      'docs/project-context',
    ]);
    expect(gitCommand.exec).toHaveBeenNthCalledWith(5, '/repo', [
      'diff',
      '--cached',
      '--name-only',
      '--',
      'docs/project-context',
    ]);
    expect(gitCommand.exec).toHaveBeenNthCalledWith(6, '/repo', [
      'commit',
      '-m',
      'docs(discovery): persist imported repository investigation',
      '--',
      'docs/project-context',
    ]);
    expect(result).toEqual({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/ARCHITECTURE.md'],
      commit_sha: 'abc1234567890',
    });
  });

  it('rejects unsafe absolute or parent-relative paths', async () => {
    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['../outside'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['/tmp/outside'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gitCommand.exec).not.toHaveBeenCalled();
  });

  it('rejects pathspec magic syntax', async () => {
    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: [':(top)**'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: [':(glob)**'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: [':!docs/project-context'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitCommand.exec).not.toHaveBeenCalled();
  });

  it('rejects parent traversal segments within a path', async () => {
    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/project-context/../other'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['a/b/../../outside'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitCommand.exec).not.toHaveBeenCalled();
  });

  it('rejects glob/wildcard metacharacters', async () => {
    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/**/*.md'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/file?.md'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/file[1].md'],
        message: 'docs(discovery): persist imported repository investigation',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitCommand.exec).not.toHaveBeenCalled();
  });

  it('runs inside the repository lock with git commands executed within the callback', async () => {
    let callbackInvoked = false;
    let gitCommandInvokedInsideCallback = false;

    lockService.runRepoExclusive.mockImplementation(
      async (repoPath: string, callback: () => Promise<unknown>) => {
        callbackInvoked = true;
        gitCommand.exec.mockResolvedValueOnce({ stdout: '', stderr: '' });
        const callsBeforeCallback = gitCommand.exec.mock.calls.length;
        const result = await callback();
        gitCommandInvokedInsideCallback =
          gitCommand.exec.mock.calls.length > callsBeforeCallback;
        return result;
      },
    );

    await service.commitPaths({
      repoPath: '/repo',
      paths: ['docs/project-context'],
      message: 'docs(discovery): persist imported repository investigation',
    });

    expect(callbackInvoked).toBe(true);
    expect(gitCommandInvokedInsideCallback).toBe(true);
    expect(lockService.runRepoExclusive).toHaveBeenCalledWith(
      '/repo',
      expect.any(Function),
    );
    expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
      'status',
      '--porcelain',
      '--',
      'docs/project-context',
    ]);
  });

  describe('push logic', () => {
    it('does not push if push param is false or omitted', async () => {
      gitCommand.exec
        .mockResolvedValueOnce({
          stdout: ' M docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          stdout: 'docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: '[main abc1234] test push\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: 'abc1234567890\n', stderr: '' });

      await service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/project-context/ARCHITECTURE.md'],
        message: 'test push',
      });

      expect(branchOps.pushBranch).not.toHaveBeenCalled();
    });

    it('pushes the current branch if push param is true and origin is configured', async () => {
      gitCommand.exec
        .mockResolvedValueOnce({
          stdout: ' M docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          stdout: 'docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: '[main abc1234] test push\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: 'abc1234567890\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

      branchOps.hasOriginRemote.mockResolvedValueOnce(true);
      branchOps.pushBranch.mockResolvedValueOnce(true);

      const result = await service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/project-context/ARCHITECTURE.md'],
        message: 'test push',
        push: true,
      });

      expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
        'symbolic-ref',
        '--short',
        'HEAD',
      ]);
      expect(branchOps.hasOriginRemote).toHaveBeenCalledWith('/repo');
      expect(branchOps.pushBranch).toHaveBeenCalledWith('/repo', 'main');
      expect(result.committed).toBe(true);
    });

    it('handles push failures gracefully and still returns committed: true', async () => {
      gitCommand.exec
        .mockResolvedValueOnce({
          stdout: ' M docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          stdout: 'docs/project-context/ARCHITECTURE.md\n',
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: '[main abc1234] test push\n',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: 'abc1234567890\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

      branchOps.hasOriginRemote.mockResolvedValueOnce(true);
      branchOps.pushBranch.mockRejectedValueOnce(new Error('Push rejected'));

      const result = await service.commitPaths({
        repoPath: '/repo',
        paths: ['docs/project-context/ARCHITECTURE.md'],
        message: 'test push',
        push: true,
      });

      expect(result.committed).toBe(true);
    });
  });
});
