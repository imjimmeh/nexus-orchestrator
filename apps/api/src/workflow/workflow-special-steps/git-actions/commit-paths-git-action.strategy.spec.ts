import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitPathsGitActionStrategy } from './commit-paths-git-action.strategy';

describe('CommitPathsGitActionStrategy', () => {
  const gitWorktreeService = {
    resolveProjectBasePath: vi.fn(),
    getExistingWorktreePath: vi.fn(),
  };

  const gitCommitPathsService = {
    commitPaths: vi.fn(),
  };

  const strategy = new CommitPathsGitActionStrategy(
    gitWorktreeService as never,
    gitCommitPathsService as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectBasePath.mockResolvedValue('/repo');
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
  });

  it('has the correct action identifier', () => {
    expect(strategy.action).toBe('commit_paths');
  });

  it('commits specified paths and returns committed output metadata', async () => {
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/investigation.md'],
      commit_sha: 'abc1234567890',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_investigation_artifacts',
      triggerContext: {
        repositoryId: 'project-1',
      },
      resolvedStepInputs: {
        paths: ['docs/project-context'],
        message: 'docs(discovery): persist imported repository investigation',
      },
    });

    expect(gitWorktreeService.resolveProjectBasePath).toHaveBeenCalledWith(
      'project-1',
    );
    expect(gitCommitPathsService.commitPaths).toHaveBeenCalledWith({
      repoPath: '/repo',
      paths: ['docs/project-context'],
      message: 'docs(discovery): persist imported repository investigation',
      push: false,
    });
    expect(result.output).toMatchObject({
      ok: true,
      action: 'commit_paths',
      repository_id: 'project-1',
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/investigation.md'],
      commit_sha: 'abc1234567890',
    });
  });

  it('commits inside the provisioned worktree when worktree_id is provided', async () => {
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/CHARTER.md'],
      commit_sha: 'def1234567890',
    });

    await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_charter_artifacts',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
      },
      resolvedStepInputs: {
        paths: ['docs/project-context'],
        message: 'docs(charter): persist project charter',
      },
    });

    expect(gitWorktreeService.getExistingWorktreePath).toHaveBeenCalledWith(
      'project-1',
      'worktree-1',
    );
    expect(gitWorktreeService.resolveProjectBasePath).not.toHaveBeenCalled();
    expect(gitCommitPathsService.commitPaths).toHaveBeenCalledWith({
      repoPath: '/data/worktrees/project-1/worktree-1',
      paths: ['docs/project-context'],
      message: 'docs(charter): persist project charter',
      push: false,
    });
  });

  it('fails loudly when worktree_id is given but no worktree is provisioned', async () => {
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);

    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_charter_artifacts',
        triggerContext: {
          repositoryId: 'project-1',
          worktreeId: 'worktree-1',
        },
        resolvedStepInputs: {
          paths: ['docs/project-context'],
          message: 'docs(charter): persist project charter',
        },
      }),
    ).rejects.toThrow(/worktree/);

    expect(gitCommitPathsService.commitPaths).not.toHaveBeenCalled();
  });

  it('returns clean output when commitPaths reports no changes', async () => {
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_investigation_artifacts',
      triggerContext: { repositoryId: 'project-1' },
      resolvedStepInputs: {
        paths: ['docs/project-context'],
        message: 'docs(discovery): persist imported repository investigation',
      },
    });

    expect(result.output).toMatchObject({
      ok: true,
      action: 'commit_paths',
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    });
  });

  it('rejects commit_paths with an empty-string path entry', async () => {
    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_investigation_artifacts',
        triggerContext: { repositoryId: 'project-1' },
        resolvedStepInputs: {
          paths: ['docs/project-context', ''],
          message: 'docs(discovery): persist investigation',
        },
      }),
    ).rejects.toThrow(
      'Step commit_investigation_artifacts: git_operation commit_paths requires inputs.paths to contain at least one non-empty string',
    );
    expect(gitCommitPathsService.commitPaths).not.toHaveBeenCalled();
  });

  it('rejects commit_paths with a non-string path entry', async () => {
    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_investigation_artifacts',
        triggerContext: { repositoryId: 'project-1' },
        resolvedStepInputs: {
          paths: ['docs/project-context', 123 as unknown as string],
          message: 'docs(discovery): persist investigation',
        },
      }),
    ).rejects.toThrow(
      'Step commit_investigation_artifacts: git_operation commit_paths requires inputs.paths to contain at least one non-empty string',
    );
    expect(gitCommitPathsService.commitPaths).not.toHaveBeenCalled();
  });
});
