import { Inject, Injectable, Logger } from '@nestjs/common';
import { GitWorktreeService } from '../../../common/git/git-worktree.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../../kernel/interfaces/workflow-kernel.ports';
import {
  requireWorktreeId,
  resolveBranchValue,
} from '../step-git-operation-special-step.helpers';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import {
  WORKSPACE_WORKTREE_PATH_STATE_KEY,
  type GitActionParams,
  type GitActionStrategy,
} from './git-action-strategy';

@Injectable()
export class ProvisionWorktreeGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'provision_worktree';
  private readonly defaultBaseBranch = 'main';
  private readonly logger = new Logger(ProvisionWorktreeGitActionStrategy.name);

  constructor(
    private readonly gitWorktreeService: GitWorktreeService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const inferredBase = await this.inferBaseBranch(
      triggerContext.repositoryId,
    );
    const worktreeId = requireWorktreeId(
      stepId,
      'provision_worktree',
      triggerContext,
    );

    const baseBranch = resolveBranchValue(
      resolvedStepInputs.base_branch,
      triggerContext.branchConfig?.baseBranch,
      inferredBase,
    );
    const rawTargetBranch = resolveBranchValue(
      resolvedStepInputs.target_branch,
      triggerContext.branchConfig?.targetBranch,
      `feature/${worktreeId}`,
    );

    if (!baseBranch || !rawTargetBranch) {
      throw new Error(
        `Step ${stepId}: git_operation provision_worktree requires base_branch and target_branch`,
      );
    }

    const targetBranch = this.normalizeTargetBranch({
      baseBranch,
      targetBranch: rawTargetBranch,
      worktreeId,
      stepId,
      repositoryId: triggerContext.repositoryId,
    });

    const worktreePath = await this.gitWorktreeService.provisionWorktree(
      triggerContext.repositoryId,
      worktreeId,
      baseBranch,
      targetBranch,
    );

    // Record the per-run worktree so execution steps in this run mount it
    // (rather than the shared clone root), avoiding cross-run contention.
    await this.runRepo.setStateVariableAtomic(
      workflowRunId,
      WORKSPACE_WORKTREE_PATH_STATE_KEY,
      worktreePath,
    );

    this.logger.log(
      `git_operation [${stepId}]: provisioned worktree ${worktreePath} for ${triggerContext.repositoryId}/${worktreeId}`,
    );

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: 'provision_worktree',
      },
      output: {
        ok: true,
        stepId,
        action: 'provision_worktree',
        repository_id: triggerContext.repositoryId,
        worktree_id: worktreeId,
        worktree_path: worktreePath,
        base_branch: baseBranch,
        target_branch: targetBranch,
      },
    };
  }

  private normalizeTargetBranch(params: {
    baseBranch: string;
    targetBranch: string;
    worktreeId: string;
    stepId: string;
    repositoryId: string;
  }): string {
    if (params.targetBranch !== params.baseBranch) {
      return params.targetBranch;
    }
    const fallback = `feature/${params.worktreeId}`;
    this.logger.warn(
      `git_operation [${params.stepId}]: target branch matched base branch for ${params.repositoryId}/${params.worktreeId}; using ${fallback}`,
    );
    return fallback;
  }

  private async inferBaseBranch(repositoryId: string): Promise<string> {
    try {
      const resolved =
        await this.gitWorktreeService.resolveProjectDefaultBranch(repositoryId);
      if (resolved) {
        return resolved;
      }
    } catch (error) {
      this.logger.warn(
        `git_operation: falling back to default base branch (${this.defaultBaseBranch}) for repository ${repositoryId}: ${(error as Error).message}`,
      );
    }

    return this.defaultBaseBranch;
  }
}
