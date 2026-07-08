import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateBranchGitActionStrategy } from './create-branch-git-action.strategy';

describe('CreateBranchGitActionStrategy', () => {
  const gitWorktreeService = {
    resolveProjectBasePath: vi.fn(),
    createBranch: vi.fn(),
  };

  const strategy = new CreateBranchGitActionStrategy(
    gitWorktreeService as never,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectBasePath.mockResolvedValue('/repo');
  });

  it('has the correct action identifier', () => {
    expect(strategy.action).toBe('create_branch');
  });

  it('creates a branch and returns completed output', async () => {
    gitWorktreeService.createBranch.mockResolvedValue(undefined);

    const result = await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'create_branch_step',
      triggerContext: {
        repositoryId: 'project-1',
        branchConfig: { baseBranch: 'main' },
      },
      resolvedStepInputs: {
        branch_name: 'feature/my-branch',
        base_branch: 'main',
      },
    });

    expect(gitWorktreeService.resolveProjectBasePath).toHaveBeenCalledWith(
      'project-1',
    );
    expect(gitWorktreeService.createBranch).toHaveBeenCalledWith(
      '/repo',
      'feature/my-branch',
      'main',
    );
    expect(result.result).toMatchObject({
      status: 'completed',
      mode: 'git_operation',
      action: 'create_branch',
    });
    expect(result.output).toMatchObject({
      ok: true,
      stepId: 'create_branch_step',
      action: 'create_branch',
      branch_name: 'feature/my-branch',
      base_branch: 'main',
      repository_id: 'project-1',
    });
  });

  it('uses triggerContext.branchConfig.baseBranch as fallback for base_branch', async () => {
    gitWorktreeService.createBranch.mockResolvedValue(undefined);

    await strategy.execute({
      workflowRunId: 'run-1',
      stepId: 'create_branch_step',
      triggerContext: {
        repositoryId: 'project-1',
        branchConfig: { baseBranch: 'develop' },
      },
      resolvedStepInputs: {
        branch_name: 'feature/my-branch',
      },
    });

    expect(gitWorktreeService.createBranch).toHaveBeenCalledWith(
      '/repo',
      'feature/my-branch',
      'develop',
    );
  });

  it('throws when branch_name is missing', async () => {
    await expect(
      strategy.execute({
        workflowRunId: 'run-1',
        stepId: 'create_branch_step',
        triggerContext: { repositoryId: 'project-1' },
        resolvedStepInputs: {},
      }),
    ).rejects.toThrow(
      'Step create_branch_step: git_operation create_branch requires inputs.branch_name',
    );

    expect(gitWorktreeService.createBranch).not.toHaveBeenCalled();
  });
});
