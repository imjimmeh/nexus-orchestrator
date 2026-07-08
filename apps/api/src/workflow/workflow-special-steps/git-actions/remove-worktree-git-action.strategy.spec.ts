import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoveWorktreeGitActionStrategy } from './remove-worktree-git-action.strategy';

describe('RemoveWorktreeGitActionStrategy', () => {
  const gitWorktreeService = {
    removeWorktree: vi.fn(),
  };

  const runRepo = {
    deleteStateVariableAtomic: vi.fn(),
  };

  const strategy = new RemoveWorktreeGitActionStrategy(
    gitWorktreeService as never,
    runRepo as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('has the correct action identifier', () => {
    expect(strategy.action).toBe('remove_worktree');
  });

  it('removes the worktree and returns clean output', async () => {
    gitWorktreeService.removeWorktree.mockResolvedValue(undefined);

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'remove_worktree',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { targetBranch: 'discovery/run-1' },
      },
      resolvedStepInputs: {
        target_branch: 'discovery/run-1',
      },
    });

    expect(gitWorktreeService.removeWorktree).toHaveBeenCalledWith(
      'project-1',
      'worktree-1',
      'discovery/run-1',
    );
    expect(result.output).toMatchObject({
      ok: true,
      action: 'remove_worktree',
      repository_id: 'project-1',
      worktree_id: 'worktree-1',
    });
  });

  it('clears the persisted worktree path from run state', async () => {
    gitWorktreeService.removeWorktree.mockResolvedValue(undefined);

    await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'remove_worktree',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { targetBranch: 'discovery/run-1' },
      },
      resolvedStepInputs: { target_branch: 'discovery/run-1' },
    });

    expect(runRepo.deleteStateVariableAtomic).toHaveBeenCalledWith(
      'run-1',
      '_internal.workspace_worktree_path',
    );
  });

  it('throws when worktree_id is missing from context', async () => {
    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'remove_step',
        triggerContext: { repositoryId: 'project-1' },
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(/remove_worktree requires inputs.worktree_id/);
  });
});
