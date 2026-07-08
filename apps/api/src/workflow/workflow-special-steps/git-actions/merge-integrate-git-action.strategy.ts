import { Injectable, Logger } from '@nestjs/common';
import { GitMergeService } from '../../../common/git/git-merge.service';
import { IntegrationStrategyResolver } from '../../../common/git/integration/integration-strategy.resolver';
import { MergeProviderFactory } from '../../../common/git/integration/merge-provider.factory';
import { PullRequestTrackingRepository } from '../../../common/git/integration/pull-request-tracking.repository';
import { getString } from '../step-git-operation-special-step.helpers';
import type { MergeMethod } from '../../../common/git/integration/merge-provider.interface';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import type { GitActionParams, GitActionStrategy } from './git-action-strategy';
import { MergeBranchResolverService } from './merge-branch-resolver.service';

const PULL_REQUEST_OPENED = 'pull_request_opened';
const PREFLIGHT_ACTION: GitOperationAction = 'merge_integrate_preflight';
const RECONCILE_ACTION: GitOperationAction = 'merge_integrate_reconcile';

/**
 * Stage 2 of the auto-merge: integrate the (already gated) feature branch.
 *
 * The resolved integration strategy decides the path:
 *  - `direct-push` (default): integrate the feature branch into the base inside
 *    the shared clone root and push hook-free — byte-for-byte unchanged.
 *  - `pull-request`: push the feature branch hook-free, open/update a PR via the
 *    provider factory, and persist a neutral `pull_request_tracking` row. The
 *    base branch is never modified by the engine on this path.
 */
@Injectable()
export class MergeIntegrateGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'merge_integrate';
  private readonly logger = new Logger(MergeIntegrateGitActionStrategy.name);

  constructor(
    private readonly gitMergeService: GitMergeService,
    private readonly branchResolver: MergeBranchResolverService,
    private readonly integrationResolver: IntegrationStrategyResolver,
    private readonly providerFactory: MergeProviderFactory,
    private readonly trackingRepo: PullRequestTrackingRepository,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const inputAction = getString(resolvedStepInputs, 'action');
    const requestedAction: GitOperationAction =
      inputAction === PREFLIGHT_ACTION || inputAction === RECONCILE_ACTION
        ? inputAction
        : this.action;
    const { baseBranch, targetBranch } = await this.branchResolver.resolve(
      stepId,
      this.action,
      triggerContext,
      resolvedStepInputs,
    );

    if (
      requestedAction === PREFLIGHT_ACTION ||
      requestedAction === RECONCILE_ACTION
    ) {
      this.logger.log(
        `git_operation [${stepId}]: ${requestedAction === PREFLIGHT_ACTION ? 'preflighting' : 'reconciling'} shared clone before integrating ${targetBranch} into ${baseBranch} for repository ${triggerContext.repositoryId}`,
      );
      const mergeResult =
        requestedAction === PREFLIGHT_ACTION
          ? await this.gitMergeService.preflightSharedCloneIntegration(
              triggerContext.repositoryId,
              targetBranch,
              baseBranch,
            )
          : await this.gitMergeService.reconcileSharedCloneIntegration(
              triggerContext.repositoryId,
              targetBranch,
              baseBranch,
            );
      return this.toMergeOutput(
        stepId,
        requestedAction,
        triggerContext,
        baseBranch,
        targetBranch,
        mergeResult,
      );
    }

    const config = this.integrationResolver.resolve(resolvedStepInputs);
    if (config.strategy === 'pull-request') {
      return this.openPullRequest({
        workflowRunId,
        stepId,
        triggerContext,
        resolvedStepInputs,
        baseBranch,
        targetBranch,
        autoMerge: config.autoMerge,
        mergeMethod: config.mergeMethod,
      });
    }

    // direct-push: existing behaviour, unchanged.
    this.logger.log(
      `git_operation [${stepId}]: integrating ${targetBranch} into ${baseBranch} for repository ${triggerContext.repositoryId} (hook-free push)`,
    );
    const mergeResult = await this.gitMergeService.integrateAndPush(
      triggerContext.repositoryId,
      targetBranch,
      baseBranch,
    );
    return this.toMergeOutput(
      stepId,
      this.action,
      triggerContext,
      baseBranch,
      targetBranch,
      mergeResult,
    );
  }

  private toMergeOutput(
    stepId: string,
    action: GitOperationAction,
    triggerContext: GitActionParams['triggerContext'],
    baseBranch: string,
    targetBranch: string,
    mergeResult: Awaited<ReturnType<GitMergeService['integrateAndPush']>>,
  ): SpecialStepHandlerResult {
    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action,
      },
      output: {
        ok: mergeResult.outcome === 'succeeded',
        stepId,
        action,
        merge_outcome: mergeResult.outcome,
        merge_message: mergeResult.message,
        auth_error_class: mergeResult.authErrorClass,
        dirty_paths: mergeResult.dirtyPaths,
        shared_clone_path: mergeResult.sharedClonePath,
        restored_paths: mergeResult.restoredPaths,
        quarantined_paths: mergeResult.quarantinedPaths,
        base_branch: baseBranch,
        target_branch: targetBranch,
        source_branch: mergeResult.sourceBranch,
        destination_branch: mergeResult.destinationBranch,
        baseMergeCommit: mergeResult.baseMergeCommit,
        mergeCommit: mergeResult.mergeCommit,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }

  private async openPullRequest(params: {
    workflowRunId: string;
    stepId: string;
    triggerContext: GitActionParams['triggerContext'];
    resolvedStepInputs: Record<string, unknown>;
    baseBranch: string;
    targetBranch: string;
    autoMerge: boolean;
    mergeMethod: MergeMethod;
  }): Promise<SpecialStepHandlerResult> {
    const {
      workflowRunId,
      stepId,
      triggerContext,
      resolvedStepInputs,
      baseBranch,
      targetBranch,
      autoMerge,
      mergeMethod,
    } = params;
    const repositoryUrl = getString(resolvedStepInputs, 'repository_url');
    const githubSecretId = getString(resolvedStepInputs, 'github_secret_id');
    if (!repositoryUrl || !githubSecretId) {
      throw new Error(
        `Step ${stepId}: pull-request strategy requires inputs.repository_url and inputs.github_secret_id`,
      );
    }

    await this.gitMergeService.pushFeatureBranch(
      triggerContext.repositoryId,
      targetBranch,
    );

    // Immutable open-time stamp surfaced as output.opened_at so a downstream
    // consumer can age open PRs. Stamped here (not derived from the provider) to
    // keep the pinned MergeProvider signatures unchanged.
    const openedAt = new Date().toISOString();

    const provider = this.providerFactory.resolveForRepository(repositoryUrl);
    // Invariant: in the ready-to-merge workflow `repositoryId` binds to `trigger.scopeId`
    // and `worktreeId` to `trigger.contextId`. The tracking row's scope_id/context_id MUST
    // equal the scope/context ids the downstream lifecycle handlers look up by, so a future
    // git_operation caller wiring different values into these trigger-context fields would
    // silently break PR-merge → done resolution.
    const ref = await provider.openOrUpdatePullRequest({
      scopeId: triggerContext.repositoryId,
      contextId: triggerContext.worktreeId ?? '',
      workflowRunId,
      repositoryUrl,
      githubSecretId,
      headBranch: targetBranch,
      baseBranch,
      title: `Integrate ${targetBranch} into ${baseBranch}`,
      body: `Automated pull request opened by the Nexus orchestration engine for scope ${triggerContext.repositoryId}.`,
    });

    if (autoMerge && provider.enableAutoMerge) {
      await provider.enableAutoMerge(ref, mergeMethod);
      this.logger.log(
        `git_operation [${stepId}]: enabled provider auto-merge (${mergeMethod}) for PR ${ref.url}`,
      );
    }

    await this.trackingRepo.recordOpenedPullRequest({
      provider: ref.provider,
      owner: ref.owner,
      repo: ref.repo,
      prNumber: ref.number,
      scopeId: triggerContext.repositoryId,
      contextId: triggerContext.worktreeId ?? '',
      workflowRunId,
      headBranch: targetBranch,
      baseBranch,
      prUrl: ref.url,
      githubSecretId,
      repositoryUrl,
      autoMerge,
      mergeMethod,
    });

    this.logger.log(
      `git_operation [${stepId}]: opened/updated PR ${ref.url} for ${triggerContext.repositoryId} (${targetBranch} -> ${baseBranch})`,
    );

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: this.action,
      },
      output: {
        ok: true,
        stepId,
        action: this.action,
        merge_outcome: PULL_REQUEST_OPENED,
        pr_url: ref.url,
        pr_number: ref.number,
        pr_provider: ref.provider,
        opened_at: openedAt,
        base_branch: baseBranch,
        target_branch: targetBranch,
        source_branch: targetBranch,
        destination_branch: baseBranch,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }
}
