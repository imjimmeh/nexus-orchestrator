import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeBranchResolverService } from './merge-branch-resolver.service';
import { MergePrepareGitActionStrategy } from './merge-prepare-git-action.strategy';

describe('MergePrepareGitActionStrategy', () => {
  const gitMergeService = {
    prepareMergeInWorktree: vi.fn(),
    integrateAndPush: vi.fn(),
  };

  const gitWorktreeService = {
    resolveProjectDefaultBranch: vi.fn(),
    listManagedWorktrees: vi.fn(),
    getExistingWorktreePath: vi.fn(),
    provisionWorktree: vi.fn(),
  };

  const resolver = new MergeBranchResolverService(gitWorktreeService as never);
  const strategy = new MergePrepareGitActionStrategy(
    gitMergeService as never,
    resolver,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue('main');
    gitWorktreeService.listManagedWorktrees.mockResolvedValue([]);
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
  });

  it('has the merge_prepare action identifier', () => {
    expect(strategy.action).toBe('merge_prepare');
  });

  it('prepares the worktree merge and never integrates/pushes on success', async () => {
    gitMergeService.prepareMergeInWorktree.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Worktree prepared',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'merge_prepare',
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

    expect(gitMergeService.prepareMergeInWorktree).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
      '/data/worktrees/project-1/worktree-1',
    );
    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
    expect(result.output.action).toBe('merge_prepare');
    expect(result.output.merge_outcome).toBe('succeeded');
    expect(result.output.ok).toBe(true);
    // The gate moved out — no quality_gate_log on prepare.
    expect(result.output).not.toHaveProperty('quality_gate_log');
  });

  it('surfaces conflict with conflicted files and does not integrate', async () => {
    gitMergeService.prepareMergeInWorktree.mockResolvedValue({
      outcome: 'conflict',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: ['src/a.ts'],
      message: 'Merge conflicts detected in 1 file(s)',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'merge_prepare',
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

    expect(result.output.merge_outcome).toBe('conflict');
    expect(result.output.conflicted_files).toEqual(['src/a.ts']);
    expect(result.output.ok).toBe(false);
    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
  });

  it('normalizes target branch when target matches base', async () => {
    gitMergeService.prepareMergeInWorktree.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'ok',
    });

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'merge_prepare',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { baseBranch: 'main', targetBranch: 'main' },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'main',
      },
    });

    expect(result.output.target_branch).toBe('feature/worktree-1');
    expect(gitMergeService.prepareMergeInWorktree).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
      '/data/worktrees/project-1/worktree-1',
    );
  });

  it('throws when base_branch and target_branch are both missing', async () => {
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue(undefined);

    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'merge_prepare',
        triggerContext: {
          repositoryId: 'project-1',
          worktreeId: 'worktree-1',
        },
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(
      'Step merge_prepare: git_operation merge_prepare requires base_branch and target_branch',
    );
  });
});
