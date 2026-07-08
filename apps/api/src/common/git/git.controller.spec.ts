import { describe, expect, it, vi } from 'vitest';
import { GitController } from './git.controller';
import type { GitCommitPathsService } from './git-commit-paths.service';
import type { GitRepositoryMetadataService } from './git-repository-metadata.service';

describe('GitController', () => {
  const createController = (metadata: Partial<GitRepositoryMetadataService>) =>
    new GitController(
      {} as GitCommitPathsService,
      metadata as GitRepositoryMetadataService,
    );

  it('lists branches through the metadata service', async () => {
    const metadata = {
      listBranches: vi.fn().mockResolvedValue(['main']),
    };
    const controller = createController(metadata);

    const response = await controller.listBranches({ repoPath: ' /repo ' });

    expect(metadata.listBranches).toHaveBeenCalledWith('/repo');
    expect(response).toEqual({ branches: ['main'] });
  });

  it('lists tracked files through the metadata service', async () => {
    const metadata = {
      listTrackedFiles: vi.fn().mockResolvedValue(['README.md']),
    };
    const controller = createController(metadata);

    const response = await controller.listTrackedFiles({ repoPath: ' /repo ' });

    expect(metadata.listTrackedFiles).toHaveBeenCalledWith('/repo');
    expect(response).toEqual({ files: ['README.md'] });
  });

  it('shows a file at a ref through the metadata service', async () => {
    const fileContent = {
      content: '# Repository',
      path: 'README.md',
      branch: 'main',
      size: 12,
    };
    const metadata = {
      readFileAtRef: vi.fn().mockResolvedValue(fileContent),
    };
    const controller = createController(metadata);

    const response = await controller.showFile({
      repoPath: ' /repo ',
      filePath: ' README.md ',
      ref: ' main ',
    });

    expect(metadata.readFileAtRef).toHaveBeenCalledWith({
      repoPath: '/repo',
      filePath: 'README.md',
      ref: 'main',
    });
    expect(response).toEqual(fileContent);
  });
});
