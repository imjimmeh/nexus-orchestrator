import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepGitOperationSpecialStepHandler } from './step-git-operation-special-step.handler';
import { MergeGitActionStrategy } from './git-actions/merge-git-action.strategy';
import { MergePrepareGitActionStrategy } from './git-actions/merge-prepare-git-action.strategy';
import { MergeIntegrateGitActionStrategy } from './git-actions/merge-integrate-git-action.strategy';
import { MergeBranchResolverService } from './git-actions/merge-branch-resolver.service';
import { IntegrationStrategyResolver } from '../../common/git/integration/integration-strategy.resolver';
import type { MergeProviderFactory } from '../../common/git/integration/merge-provider.factory';
import type { PullRequestTrackingRepository } from '../../common/git/integration/pull-request-tracking.repository';
import { ProvisionWorktreeGitActionStrategy } from './git-actions/provision-worktree-git-action.strategy';
import { RemoveWorktreeGitActionStrategy } from './git-actions/remove-worktree-git-action.strategy';
import { CreateBranchGitActionStrategy } from './git-actions/create-branch-git-action.strategy';
import { CommitPathsGitActionStrategy } from './git-actions/commit-paths-git-action.strategy';

describe('StepGitOperationSpecialStepHandler', () => {
  const gitMergeService = {
    mergeWithConflictDetection: vi.fn(),
    prepareMergeInWorktree: vi.fn(),
    integrateAndPush: vi.fn(),
  };

  const gitWorktreeService = {
    resolveProjectDefaultBranch: vi.fn(),
    resolveProjectBasePath: vi.fn(),
    getExistingWorktreePath: vi.fn(),
    listManagedWorktrees: vi.fn(),
    createBranch: vi.fn(),
    provisionWorktree: vi.fn(),
    removeWorktree: vi.fn(),
  };

  const gitCommitPathsService = {
    commitPaths: vi.fn(),
  };

  const runRepo = {
    findById: vi.fn(),
    setStateVariableAtomic: vi.fn(),
    deleteStateVariableAtomic: vi.fn(),
  };

  const branchResolver = new MergeBranchResolverService(
    gitWorktreeService as never,
  );

  const handler = new StepGitOperationSpecialStepHandler(
    runRepo as never,
    new MergeGitActionStrategy(gitMergeService as never, branchResolver),
    new MergePrepareGitActionStrategy(gitMergeService as never, branchResolver),
    new MergeIntegrateGitActionStrategy(
      gitMergeService as never,
      branchResolver,
      new IntegrationStrategyResolver(),
      {} as MergeProviderFactory,
      {} as PullRequestTrackingRepository,
    ),
    new ProvisionWorktreeGitActionStrategy(
      gitWorktreeService as never,
      runRepo as never,
    ),
    new RemoveWorktreeGitActionStrategy(
      gitWorktreeService as never,
      runRepo as never,
    ),
    new CreateBranchGitActionStrategy(gitWorktreeService as never),
    new CommitPathsGitActionStrategy(
      gitWorktreeService as never,
      gitCommitPathsService as never,
    ),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    gitWorktreeService.resolveProjectDefaultBranch.mockResolvedValue('main');
    gitWorktreeService.resolveProjectBasePath.mockResolvedValue('/repo');
    gitWorktreeService.listManagedWorktrees.mockResolvedValue([]);
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
    runRepo.findById.mockResolvedValue({
      state_variables: {
        trigger: {
          git: {
            scope_id: 'project-1',
            worktree_id: 'worktree-1',
            base_branch: 'main',
            target_branch: 'main',
          },
        },
      },
    });
  });

  it('is registered as a core-domain primitive', () => {
    expect(handler.descriptor).toMatchObject({
      type: 'git_operation',
      owningDomain: 'core',
    });
  });

  it('normalizes merge target branch when target matches base', async () => {
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'ok',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      step: { id: 'attempt_merge', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge',
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

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      step: { id: 'attempt_merge', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge',
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
    expect(result.output.merge_outcome).toBe('succeeded');
  });

  it('provisions a worktree for the merge when none exists yet and passes its path', async () => {
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

    await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      step: { id: 'attempt_merge', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge',
        base_branch: 'main',
        target_branch: 'feature/worktree-1',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
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

  it('exposes auth_error metadata when merge operation cannot authenticate', async () => {
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'auth_error',
      sourceBranch: 'feature/work-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Authentication failed',
      authErrorClass: 'credentials',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'validate_merge',
      step: { id: 'validate_merge', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge',
        base_branch: 'main',
        target_branch: 'feature/work-1',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
      },
    });

    expect(result.output.ok).toBe(false);
    expect(result.output.merge_outcome).toBe('auth_error');
    expect(result.output.auth_error_class).toBe('credentials');
    expect(result.output.merge_message).toContain('Authentication failed');
  });

  it('surfaces quality_gate_log when a push is rejected by the pre-push hook', async () => {
    gitMergeService.mergeWithConflictDetection.mockResolvedValue({
      outcome: 'quality_gate_failed',
      sourceBranch: 'feature/ctx',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Push rejected by the pre-push quality gate (lint/tests).',
      qualityGateLog: 'eslint found errors\nfailed to push some refs',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'attempt_merge',
      step: { id: 'attempt_merge', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge',
        base_branch: 'main',
        target_branch: 'feature/ctx',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
      },
    });

    expect(result.output).toMatchObject({
      merge_outcome: 'quality_gate_failed',
      quality_gate_log: 'eslint found errors\nfailed to push some refs',
    });
  });

  it('dispatches action merge_prepare to the prepare strategy (stage 1, no push)', async () => {
    gitMergeService.prepareMergeInWorktree.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Worktree prepared',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'merge_prepare',
      step: { id: 'merge_prepare', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge_prepare',
        base_branch: 'main',
        target_branch: 'feature/worktree-1',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
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
  });

  it('dispatches action merge_integrate to the integrate strategy (stage 2, hook-free push)', async () => {
    gitMergeService.integrateAndPush.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/worktree-1',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'merged',
      mergeCommit: 'merge-sha',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'merge_integrate',
      step: { id: 'merge_integrate', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'merge_integrate',
        base_branch: 'main',
        target_branch: 'feature/worktree-1',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
      },
    });

    expect(gitMergeService.integrateAndPush).toHaveBeenCalledWith(
      'project-1',
      'feature/worktree-1',
      'main',
    );
    expect(result.output.action).toBe('merge_integrate');
    expect(result.output.mergeCommit).toBe('merge-sha');
  });

  it('rejects an unknown git_operation action', async () => {
    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'bad_step',
        step: { id: 'bad_step', type: 'git_operation', tier: 'light' },
        resolvedStepInputs: {
          action: 'not_a_real_action',
          repository_id: 'project-1',
          worktree_id: 'worktree-1',
        },
      }),
    ).rejects.toThrow(/inputs\.action/);
  });

  it('provisions a worktree from explicit generic inputs without loading or updating work items', async () => {
    gitWorktreeService.provisionWorktree.mockResolvedValue('/tmp/worktree');

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'provision_worktree',
      step: { id: 'provision_worktree', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'provision_worktree',
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

  it('persists the provisioned worktree path into run state for per-run mounting', async () => {
    gitWorktreeService.provisionWorktree.mockResolvedValue(
      '/data/worktrees/project-1/run-1',
    );

    await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'provision_worktree',
      step: { id: 'provision_worktree', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'provision_worktree',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
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

  it('clears the persisted worktree path when removing the worktree', async () => {
    await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'remove_worktree',
      step: { id: 'remove_worktree', type: 'git_operation', tier: 'light' },
      resolvedStepInputs: {
        action: 'remove_worktree',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
        target_branch: 'discovery/run-1',
      },
    });

    expect(runRepo.deleteStateVariableAtomic).toHaveBeenCalledWith(
      'run-1',
      '_internal.workspace_worktree_path',
    );
  });

  it('commits specified paths and returns committed output metadata', async () => {
    // No worktree in context — falls back to committing at the clone root.
    runRepo.findById.mockResolvedValue({
      state_variables: {
        trigger: { git: { scope_id: 'project-1', base_branch: 'main' } },
      },
    });
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/investigation.md'],
      commit_sha: 'abc1234567890',
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_investigation_artifacts',
      step: {
        id: 'commit_investigation_artifacts',
        type: 'git_operation',
        tier: 'light',
      },
      resolvedStepInputs: {
        action: 'commit_paths',
        repository_id: 'project-1',
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
    gitWorktreeService.getExistingWorktreePath.mockResolvedValue(
      '/data/worktrees/project-1/worktree-1',
    );
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: true,
      status: 'committed',
      changed_files: ['docs/project-context/CHARTER.md'],
      commit_sha: 'def1234567890',
    });

    await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_charter_artifacts',
      step: {
        id: 'commit_charter_artifacts',
        type: 'git_operation',
        tier: 'light',
      },
      resolvedStepInputs: {
        action: 'commit_paths',
        repository_id: 'project-1',
        worktree_id: 'worktree-1',
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
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_charter_artifacts',
        step: {
          id: 'commit_charter_artifacts',
          type: 'git_operation',
          tier: 'light',
        },
        resolvedStepInputs: {
          action: 'commit_paths',
          repository_id: 'project-1',
          worktree_id: 'worktree-1',
          paths: ['docs/project-context'],
          message: 'docs(charter): persist project charter',
        },
      }),
    ).rejects.toThrow(/worktree/);

    expect(gitCommitPathsService.commitPaths).not.toHaveBeenCalled();
  });

  it('returns clean output when commitPaths reports no changes', async () => {
    runRepo.findById.mockResolvedValue({
      state_variables: {
        trigger: { git: { scope_id: 'project-1', base_branch: 'main' } },
      },
    });
    gitCommitPathsService.commitPaths.mockResolvedValue({
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    });

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'commit_investigation_artifacts',
      step: {
        id: 'commit_investigation_artifacts',
        type: 'git_operation',
        tier: 'light',
      },
      resolvedStepInputs: {
        action: 'commit_paths',
        repository_id: 'project-1',
        paths: ['docs/project-context'],
        message: 'docs(discovery): persist imported repository investigation',
      },
    });

    expect(gitCommitPathsService.commitPaths).toHaveBeenCalled();
    expect(result.output).toMatchObject({
      ok: true,
      action: 'commit_paths',
      repository_id: 'project-1',
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    });
  });

  it('rejects commit_paths with an empty-string path entry', async () => {
    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_investigation_artifacts',
        step: {
          id: 'commit_investigation_artifacts',
          type: 'git_operation',
          tier: 'light',
        },
        resolvedStepInputs: {
          action: 'commit_paths',
          repository_id: 'project-1',
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
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'commit_investigation_artifacts',
        step: {
          id: 'commit_investigation_artifacts',
          type: 'git_operation',
          tier: 'light',
        },
        resolvedStepInputs: {
          action: 'commit_paths',
          repository_id: 'project-1',
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
