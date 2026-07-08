import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeIntegrateGitActionStrategy } from './merge-integrate-git-action.strategy';

const triggerContext = {
  repositoryId: 'scope-1',
  worktreeId: 'context-1',
  branchConfig: { baseBranch: 'main', targetBranch: 'feature/x' },
};

function buildStrategy(
  overrides: Partial<{
    strategy: 'direct-push' | 'pull-request';
    autoMerge: boolean;
    mergeMethod: 'merge' | 'squash' | 'rebase';
  }> = {},
) {
  const gitMergeService = {
    preflightSharedCloneIntegration: vi.fn().mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      dirtyPaths: [],
      message: 'Shared clone is clean',
    }),
    reconcileSharedCloneIntegration: vi.fn().mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      dirtyPaths: [],
      message: 'Shared clone reconciled deterministically',
    }),
    integrateAndPush: vi.fn().mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'ok',
      baseMergeCommit: 'base-sha',
      mergeCommit: 'merge-sha',
    }),
    pushFeatureBranch: vi.fn().mockResolvedValue(undefined),
  };
  const branchResolver = {
    resolve: vi.fn().mockResolvedValue({
      baseBranch: 'main',
      targetBranch: 'feature/x',
      worktreeId: 'context-1',
      worktreePath: '/wt',
    }),
  };
  const integrationResolver = {
    resolve: vi.fn().mockReturnValue({
      strategy: overrides.strategy ?? 'direct-push',
      mergeMethod: overrides.mergeMethod ?? 'merge',
      autoMerge: overrides.autoMerge ?? false,
      preflightGate: true,
    }),
  };
  const mergeProvider = {
    providerKey: 'github',
    openOrUpdatePullRequest: vi.fn().mockResolvedValue({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
    }),
    getPullRequestStatus: vi.fn(),
    mergePullRequest: vi.fn(),
    enableAutoMerge: vi.fn().mockResolvedValue(undefined),
  };
  const providerFactory = {
    resolveForRepository: vi.fn().mockReturnValue(mergeProvider),
  };
  const trackingRepo = {
    recordOpenedPullRequest: vi.fn().mockResolvedValue({ id: 'row-1' }),
  };
  const strategy = new MergeIntegrateGitActionStrategy(
    gitMergeService as never,
    branchResolver as never,
    integrationResolver as never,
    providerFactory as never,
    trackingRepo as never,
  );
  return {
    strategy,
    gitMergeService,
    integrationResolver,
    mergeProvider,
    providerFactory,
    trackingRepo,
  };
}

describe('MergeIntegrateGitActionStrategy', () => {
  let workflowRunId: string;
  beforeEach(() => {
    workflowRunId = '11111111-1111-1111-1111-111111111111';
  });

  it('has the merge_integrate action identifier', () => {
    const { strategy } = buildStrategy();
    expect(strategy.action).toBe('merge_integrate');
  });

  it('direct-push (regression): integrates and pushes to base, unchanged output', async () => {
    const { strategy, gitMergeService, mergeProvider, trackingRepo } =
      buildStrategy({ strategy: 'direct-push' });

    const result = await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {},
    });

    expect(gitMergeService.integrateAndPush).toHaveBeenCalledWith(
      'scope-1',
      'feature/x',
      'main',
    );
    expect(mergeProvider.openOrUpdatePullRequest).not.toHaveBeenCalled();
    expect(trackingRepo.recordOpenedPullRequest).not.toHaveBeenCalled();
    expect(result.output.merge_outcome).toBe('succeeded');
    expect(result.output.ok).toBe(true);
    expect(result.output.mergeCommit).toBe('merge-sha');
    expect(result.output.baseMergeCommit).toBe('base-sha');
  });

  it('preflight: reports dirty shared-clone state without integrating or pushing', async () => {
    const { strategy, gitMergeService } = buildStrategy({
      strategy: 'direct-push',
    });
    gitMergeService.preflightSharedCloneIntegration.mockResolvedValue({
      outcome: 'shared_clone_dirty',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      dirtyPaths: ['docs/resources/child-1.md'],
      message:
        'Shared clone has files that must be reconciled before integration: docs/resources/child-1.md',
    });

    const result = await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate_preflight',
      triggerContext,
      resolvedStepInputs: { action: 'merge_integrate_preflight' },
    });

    expect(
      gitMergeService.preflightSharedCloneIntegration,
    ).toHaveBeenCalledWith('scope-1', 'feature/x', 'main');
    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({
      ok: false,
      action: 'merge_integrate_preflight',
      merge_outcome: 'shared_clone_dirty',
      dirty_paths: ['docs/resources/child-1.md'],
    });
  });

  it('runs deterministic reconciliation for action merge_integrate_reconcile and surfaces reconcile evidence', async () => {
    const { strategy, gitMergeService } = buildStrategy({
      strategy: 'direct-push',
    });
    gitMergeService.reconcileSharedCloneIntegration.mockResolvedValue({
      outcome: 'succeeded',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      dirtyPaths: [],
      sharedClonePath: '/data/nexus-workspaces/clones/scope-1',
      restoredPaths: ['.agents/skills/debugging/SKILL.md'],
      quarantinedPaths: ['docs/resources/child-1.md'],
      message: 'Shared clone reconciled deterministically',
    });

    const result = await strategy.execute({
      workflowRunId,
      stepId: 'reconcile_deterministic',
      triggerContext,
      resolvedStepInputs: { action: 'merge_integrate_reconcile' },
    });

    expect(
      gitMergeService.reconcileSharedCloneIntegration,
    ).toHaveBeenCalledWith('scope-1', 'feature/x', 'main');
    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({
      ok: true,
      action: 'merge_integrate_reconcile',
      merge_outcome: 'succeeded',
      shared_clone_path: '/data/nexus-workspaces/clones/scope-1',
      restored_paths: ['.agents/skills/debugging/SKILL.md'],
      quarantined_paths: ['docs/resources/child-1.md'],
    });
  });

  it('direct-push: maps auth_error to ok:false with auth_error_class', async () => {
    const { strategy, gitMergeService } = buildStrategy({
      strategy: 'direct-push',
    });
    gitMergeService.integrateAndPush.mockResolvedValue({
      outcome: 'auth_error',
      sourceBranch: 'feature/x',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Authentication failed',
      authErrorClass: 'credentials',
    });

    const result = await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {},
    });

    expect(result.output.ok).toBe(false);
    expect(result.output.merge_outcome).toBe('auth_error');
    expect(result.output.auth_error_class).toBe('credentials');
  });

  it('pull-request: pushes feature branch, opens PR, persists tracking, returns pr_url', async () => {
    const { strategy, gitMergeService, mergeProvider, trackingRepo } =
      buildStrategy({ strategy: 'pull-request' });

    const result = await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {
        repository_url: 'https://github.com/acme/widgets.git',
        github_secret_id: 'secret-1',
      },
    });

    expect(gitMergeService.integrateAndPush).not.toHaveBeenCalled();
    expect(gitMergeService.pushFeatureBranch).toHaveBeenCalledWith(
      'scope-1',
      'feature/x',
    );
    expect(mergeProvider.openOrUpdatePullRequest).toHaveBeenCalledTimes(1);
    expect(trackingRepo.recordOpenedPullRequest).toHaveBeenCalledTimes(1);
    expect(result.output.merge_outcome).toBe('pull_request_opened');
    expect(result.output.pr_url).toBe(
      'https://github.com/acme/widgets/pull/42',
    );
    expect(result.output.pr_number).toBe(42);
    expect(result.output.ok).toBe(true);
  });

  it('pull-request: stamps an ISO opened_at timestamp in the output', async () => {
    const { strategy } = buildStrategy({ strategy: 'pull-request' });

    const before = Date.now();
    const result = await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {
        repository_url: 'https://github.com/acme/widgets.git',
        github_secret_id: 'secret-1',
      },
    });
    const after = Date.now();

    const openedAt = result.output.opened_at;
    expect(typeof openedAt).toBe('string');
    const openedMs = Date.parse(openedAt as string);
    expect(Number.isFinite(openedMs)).toBe(true);
    expect(openedMs).toBeGreaterThanOrEqual(before);
    expect(openedMs).toBeLessThanOrEqual(after);
  });

  it('pull-request re-run: delegates to find-or-create (no duplicate insert)', async () => {
    const { strategy, trackingRepo } = buildStrategy({
      strategy: 'pull-request',
    });

    await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {
        repository_url: 'https://github.com/acme/widgets.git',
        github_secret_id: 'secret-1',
      },
    });

    const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
    expect(recordInput).toMatchObject({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      scopeId: 'scope-1',
      contextId: 'context-1',
      headBranch: 'feature/x',
      baseBranch: 'main',
      workflowRunId,
      githubSecretId: 'secret-1',
      repositoryUrl: 'https://github.com/acme/widgets.git',
    });
  });

  it('pull-request: reads the integration strategy from the resolved step inputs (trigger projection)', async () => {
    const { strategy, integrationResolver } = buildStrategy({
      strategy: 'pull-request',
    });
    const resolvedStepInputs = {
      integration_strategy: 'pull-request',
      integration_merge_method: 'squash',
      integration_auto_merge: true,
      integration_preflight_gate: false,
      repository_url: 'https://github.com/acme/widgets.git',
      github_secret_id: 'secret-1',
    };

    await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs,
    });

    expect(integrationResolver.resolve).toHaveBeenCalledWith(
      resolvedStepInputs,
    );
  });

  it('pull-request + autoMerge=true: enables provider auto-merge with the configured method, does not API-merge', async () => {
    const { strategy, mergeProvider, trackingRepo } = buildStrategy({
      strategy: 'pull-request',
      autoMerge: true,
      mergeMethod: 'squash',
    });

    await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {
        repository_url: 'https://github.com/acme/widgets.git',
        github_secret_id: 'secret-1',
      },
    });

    expect(mergeProvider.openOrUpdatePullRequest).toHaveBeenCalledTimes(1);
    expect(mergeProvider.enableAutoMerge).toHaveBeenCalledWith(
      expect.objectContaining({ number: 42, provider: 'github' }),
      'squash',
    );
    expect(mergeProvider.mergePullRequest).not.toHaveBeenCalled();

    const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
    expect(recordInput).toMatchObject({
      autoMerge: true,
      mergeMethod: 'squash',
    });
  });

  it('pull-request + autoMerge=false: does NOT enable provider auto-merge, records autoMerge=false', async () => {
    const { strategy, mergeProvider, trackingRepo } = buildStrategy({
      strategy: 'pull-request',
      autoMerge: false,
      mergeMethod: 'merge',
    });

    await strategy.execute({
      workflowRunId,
      stepId: 'merge_integrate',
      triggerContext,
      resolvedStepInputs: {
        repository_url: 'https://github.com/acme/widgets.git',
        github_secret_id: 'secret-1',
      },
    });

    expect(mergeProvider.enableAutoMerge).not.toHaveBeenCalled();
    const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
    expect(recordInput).toMatchObject({
      autoMerge: false,
      mergeMethod: 'merge',
    });
  });

  it('pull-request: fails fast when repository_url or github_secret_id is absent', async () => {
    const { strategy } = buildStrategy({ strategy: 'pull-request' });

    await expect(
      strategy.execute({
        workflowRunId,
        stepId: 'merge_integrate',
        triggerContext,
        resolvedStepInputs: {
          repository_url: 'https://github.com/acme/widgets.git',
        },
      }),
    ).rejects.toThrow(/github_secret_id/);
  });
});
