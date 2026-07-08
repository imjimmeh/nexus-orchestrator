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
export class RemoveWorktreeGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'remove_worktree';
  private readonly logger = new Logger(RemoveWorktreeGitActionStrategy.name);

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
    const targetBranch = resolveBranchValue(
      resolvedStepInputs.target_branch,
      triggerContext.branchConfig?.targetBranch,
    );
    const worktreeId = requireWorktreeId(
      stepId,
      'remove_worktree',
      triggerContext,
    );

    await this.gitWorktreeService.removeWorktree(
      triggerContext.repositoryId,
      worktreeId,
      targetBranch,
    );

    // Drop the per-run worktree marker so any later step falls back to the
    // clone root rather than a path that no longer exists.
    await this.runRepo.deleteStateVariableAtomic(
      workflowRunId,
      WORKSPACE_WORKTREE_PATH_STATE_KEY,
    );

    this.logger.log(
      `git_operation [${stepId}]: removed worktree for ${triggerContext.repositoryId}/${worktreeId}`,
    );

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: 'remove_worktree',
      },
      output: {
        ok: true,
        stepId,
        action: 'remove_worktree',
        repository_id: triggerContext.repositoryId,
        worktree_id: worktreeId,
      },
    };
  }
}
