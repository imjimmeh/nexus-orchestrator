import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { CommitPathsGitActionStrategy } from './git-actions/commit-paths-git-action.strategy';
import type { GitActionStrategy } from './git-actions/git-action-strategy';
import { CreateBranchGitActionStrategy } from './git-actions/create-branch-git-action.strategy';
import { MergeGitActionStrategy } from './git-actions/merge-git-action.strategy';
import { MergeIntegrateGitActionStrategy } from './git-actions/merge-integrate-git-action.strategy';
import { MergePrepareGitActionStrategy } from './git-actions/merge-prepare-git-action.strategy';
import { ProvisionWorktreeGitActionStrategy } from './git-actions/provision-worktree-git-action.strategy';
import { RemoveWorktreeGitActionStrategy } from './git-actions/remove-worktree-git-action.strategy';
import {
  asRecord,
  getString,
  resolveBranchValue,
} from './step-git-operation-special-step.helpers';
import type {
  GitOperationAction,
  TriggerContext,
} from './step-git-operation-special-step.types';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

@Injectable()
export class StepGitOperationSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'git_operation' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract:
      'inputs.action + inputs.repository_id + branch/worktree inputs',
  } as const;

  private readonly logger = new Logger(StepGitOperationSpecialStepHandler.name);
  private readonly strategies: Map<GitOperationAction, GitActionStrategy>;

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    mergeStrategy: MergeGitActionStrategy,
    mergePrepareStrategy: MergePrepareGitActionStrategy,
    mergeIntegrateStrategy: MergeIntegrateGitActionStrategy,
    provisionWorktreeStrategy: ProvisionWorktreeGitActionStrategy,
    removeWorktreeStrategy: RemoveWorktreeGitActionStrategy,
    createBranchStrategy: CreateBranchGitActionStrategy,
    commitPathsStrategy: CommitPathsGitActionStrategy,
  ) {
    this.strategies = new Map<GitOperationAction, GitActionStrategy>([
      [mergeStrategy.action, mergeStrategy],
      [mergePrepareStrategy.action, mergePrepareStrategy],
      [mergeIntegrateStrategy.action, mergeIntegrateStrategy],
      ['merge_integrate_preflight', mergeIntegrateStrategy],
      ['merge_integrate_reconcile', mergeIntegrateStrategy],
      [provisionWorktreeStrategy.action, provisionWorktreeStrategy],
      [removeWorktreeStrategy.action, removeWorktreeStrategy],
      [createBranchStrategy.action, createBranchStrategy],
      [commitPathsStrategy.action, commitPathsStrategy],
    ]);
  }

  async execute({
    workflowRunId,
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const action = this.resolveAction(stepId, resolvedStepInputs);
    const triggerContext = await this.extractTriggerContext(
      workflowRunId,
      stepId,
      resolvedStepInputs,
    );
    const strategy = this.strategies.get(action);
    if (!strategy) {
      throw new Error(`Unsupported git_operation action "${action}"`);
    }
    return strategy.execute({
      workflowRunId,
      stepId,
      triggerContext,
      resolvedStepInputs,
    });
  }

  private resolveAction(
    stepId: string,
    inputs: Record<string, unknown>,
  ): GitOperationAction {
    const action = inputs.action;
    if (
      action !== 'merge' &&
      action !== 'merge_prepare' &&
      action !== 'merge_integrate' &&
      action !== 'merge_integrate_preflight' &&
      action !== 'merge_integrate_reconcile' &&
      action !== 'provision_worktree' &&
      action !== 'remove_worktree' &&
      action !== 'create_branch' &&
      action !== 'commit_paths'
    ) {
      throw new Error(
        `Step ${stepId}: git_operation requires inputs.action to be 'merge', 'merge_prepare', 'merge_integrate', 'merge_integrate_preflight', 'merge_integrate_reconcile', 'provision_worktree', 'remove_worktree', 'create_branch', or 'commit_paths'`,
      );
    }
    return action;
  }

  private async extractTriggerContext(
    workflowRunId: string,
    stepId: string,
    inputs: Record<string, unknown>,
  ): Promise<TriggerContext> {
    const run = await this.runRepo.findById(workflowRunId);
    const stateVariables = asRecord(run?.state_variables);
    const trigger = asRecord(stateVariables.trigger);
    const triggerGit = asRecord(trigger?.git);
    const repositoryId = resolveBranchValue(
      inputs.repository_id,
      getString(triggerGit, 'repository_id'),
    );
    const worktreeId = resolveBranchValue(
      inputs.worktree_id,
      getString(triggerGit, 'worktree_id'),
    );

    if (!repositoryId) {
      throw new Error(
        `Step ${stepId}: git_operation requires inputs.repository_id or trigger.git.repository_id`,
      );
    }

    const branchConfig = this.readBranchConfig(inputs, triggerGit);

    return {
      repositoryId,
      worktreeId,
      branchConfig,
    };
  }

  private readBranchConfig(
    inputs: Record<string, unknown>,
    triggerGit: Record<string, unknown> | undefined,
  ): TriggerContext['branchConfig'] {
    const baseBranch = resolveBranchValue(
      inputs.base_branch,
      getString(triggerGit, 'base_branch'),
    );
    const targetBranch = resolveBranchValue(
      inputs.target_branch,
      getString(triggerGit, 'target_branch'),
    );

    return { baseBranch, targetBranch };
  }
}
