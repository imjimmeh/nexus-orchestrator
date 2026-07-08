import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvisionWorktreeGitActionStrategy } from './provision-worktree-git-action.strategy';

describe('ProvisionWorktreeGitActionStrategy', () => {
  const gitWorktreeService = {
    resolveProjectDefaultBranch: vi.fn(),
    provisionWorktree: vi.fn(),
  };

  const runRepo = {
    setStateVariableAtomic: vi.fn(),
  };

  const strategy = new ProvisionWorktreeGitActionStrategy(
    gitWorktreeService as never,
    runRepo as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue('main');
  });

  it('has the correct action identifier', () => {
    expect(strategy.action).toBe('provision_worktree');
  });

  it('provisions a worktree and returns the path in output', async () => {
    gitWorktreeService.provisionWorktree.mockResolvedValue('/tmp/worktree');

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'provision_worktree',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: {
          baseBranch: 'main',
          targetBranch: 'feature/worktree-1',
        },
      },
      resolvedStepInputs: {
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
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
    expect(result.output).toMatchObject({
      ok: true,
      action: 'provision_worktree',
      repository_id: 'project-1',
      worktree_id: 'worktree-1',
      worktree_path: '/tmp/worktree',
    });
  });

  it('persists the provisioned worktree path into run state', async () => {
    gitWorktreeService.provisionWorktree.mockResolvedValue(
      '/data/worktrees/project-1/run-1',
    );

    await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'provision_worktree',
      triggerContext: {
        repositoryId: 'project-1',
        worktreeId: 'worktree-1',
        branchConfig: { baseBranch: 'main', targetBranch: 'discovery/run-1' },
      },
      resolvedStepInputs: {
        base_branch: 'main',
        target_branch: 'discovery/run-1',
      },
    });

    expect(runRepo.setStateVariableAtomic).toHaveBeenCalledWith(
      'run-1',
      '_internal.workspace_worktree_path',
      '/data/worktrees/project-1/run-1',
    );
  });

  it('throws when worktree_id is missing from context', async () => {
    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'provision_step',
        triggerContext: { repositoryId: 'project-1' },
        resolvedStepInputs: { base_branch: 'main', target_branch: 'feature/x' },
      }),
    ).rejects.toThrow(/provision_worktree requires inputs.worktree_id/);
  });
});
