import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeBranchResolverService } from './merge-branch-resolver.service';
import { MergeGitActionStrategy } from './merge-git-action.strategy';

describe('MergeGitActionStrategy', () => {
  const gitMergeService = {
    mergeWithConflictDetection: vi.fn(),
  };

  const gitWorktreeService = {
    resolveProjectDefaultBranch: vi.fn(),
    listManagedWorktrees: vi.fn(),
    getExistingWorktreePath: vi.fn(),
    provisionWorktree: vi.fn(),
  };

  const strategy = new MergeGitActionStrategy(
    gitMergeService as never,
    new MergeBranchResolverService(gitWorktreeService as never),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue('main');
    gitWorktreeService.listManagedWorktrees.mockResolvedValue([]);
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
  });

  it('has the correct action identifier', () => {
    expect(strategy.action).toBe('merge');
  });

  it('normalizes merge target branch when target matches base', async () => {
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'ok',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { baseBranch: 'main', targetBranch: 'main' },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'main',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
      },
    });

    expect(gitMergeService.mergeWithConflictDetection).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
      '/data/worktrees/project-1/worktree-1',
    );
    expect(result.output.target_branch).toBe('feature/worktree-1');
    expect(result.output.merge_outcome).toBe('succeeded');
  });

  it('resolves stale target_branch from actual managed worktree branch', async () => {
    gitWorktreeService.listManagedWorktrees.mockResolvedValue([
      {
        path: '/data/nexus-workspaces/worktrees/project-1/worktree-1',
        branch: 'feature/worktree-1',
        head: 'abc123def456',
      },
    ]);
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'ok',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: {
          baseBranch: 'main',
          targetBranch: 'feature/stale-slug',
        },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'feature/stale-slug',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
      },
    });

    expect(gitMergeService.mergeWithConflictDetection).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
      '/data/worktrees/project-1/worktree-1',
    );
    expect(result.output.target_branch).toBe('feature/worktree-1');
  });

  it('provisions a worktree when none exists and passes its path', async () => {
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);
    gitWorktreeService.provisionWorktree.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'conflict',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: ['src/a.ts'],
      message: 'Merge conflicts detected in 1 file(s)',
    });

    await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: {
          baseBranch: 'main',
          targetBranch: 'feature/worktree-1',
        },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'feature/worktree-1',
      },
    });

    expect(gitWorktreeService.provisionWorktree).toHaveBeenCalledWith(
      'project-1',
      'worktree-1',
      'main',
      'feature/worktree-1',
    );
    expect(gitMergeService.mergeWithConflictDetection).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
      '/data/worktrees/project-1/worktree-1',
    );
  });

  it('exposes auth_error metadata when merge cannot authenticate', async () => {
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'auth_error',
      sourceBranch: 'feature/work-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Authentication failed',
      authErrorClass: 'credentials',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'validate_merge',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { baseBranch: 'main', targetBranch: 'feature/work-1' },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'feature/work-1',
      },
    });

    expect(result.output.ok).toBe(false);
    expect(result.output.merge_outcome).toBe('auth_error');
    expect(result.output.auth_error_class).toBe('credentials');
    expect(result.output.merge_message).toContain('Authentication failed');
  });

  it('throws when base_branch and target_branch are both missing', async () => {
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue(undefined);

    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'merge_step',
        triggerContext: {
          repositoryId: 'project-1',
          worktreeId: 'worktree-1',
        },
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(
      'Step merge_step: git_operation merge requires base_branch and target_branch',
    );
  });
});
