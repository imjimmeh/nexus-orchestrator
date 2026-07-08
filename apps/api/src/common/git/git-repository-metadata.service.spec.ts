import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitRepositoryMetadataService } from './git-repository-metadata.service';

describe('GitRepositoryMetadataService', () => {
  const gitCommand = {
    exec: vi.fn(),
    execLines: vi.fn(),
  };

  const service = new GitRepositoryMetadataService(gitCommand as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists sorted normalized local and remote branches', async () => {
    gitCommand.execLines
      .mockResolvedValueOnce(['main', 'feature/a'])
      .mockResolvedValueOnce(['origin/release', 'origin/main']);

    const result = await service.listBranches('/repo');

    expect(gitCommand.execLines).toHaveBeenNthCalledWith(1, '/repo', [
      'branch',
      '--format=%(refname:short)',
    ]);
    expect(gitCommand.execLines).toHaveBeenNthCalledWith(2, '/repo', [
      'branch',
      '-r',
      '--format=%(refname:short)',
    ]);
    expect(result).toEqual(['feature/a', 'main', 'release']);
  });

  it('lists sorted tracked files with normalized separators', async () => {
    gitCommand.execLines.mockResolvedValueOnce(['src\\index.ts', 'README.md']);

    const result = await service.listTrackedFiles('/repo');

    expect(gitCommand.execLines).toHaveBeenCalledWith('/repo', ['ls-files']);
    expect(result).toEqual(['README.md', 'src/index.ts']);
  });

  it('reads file content at a ref', async () => {
    gitCommand.exec.mockResolvedValueOnce({
      stdout: '# Repository\n',
      stderr: '',
    });

    const result = await service.readFileAtRef({
      repoPath: '/repo',
      filePath: 'README.md',
      ref: 'main',
    });

    expect(gitCommand.exec).toHaveBeenCalledWith('/repo', [
      'show',
      'main:README.md',
    ]);
    expect(result).toEqual({
      content: '# Repository\n',
      path: 'README.md',
      branch: 'main',
      size: 13,
    });
  });

  it('rejects empty or parent-relative file paths before running git', async () => {
    await expect(
      service.readFileAtRef({ repoPath: '/repo', filePath: '', ref: 'main' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.readFileAtRef({
        repoPath: '/repo',
        filePath: '../README.md',
        ref: 'main',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(gitCommand.exec).not.toHaveBeenCalled();
  });
});
