import { Injectable, Logger } from '@nestjs/common';
import { GitWorktreeService } from '../../../common/git/git-worktree.service';
import { resolveBranchValue } from '../step-git-operation-special-step.helpers';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import type { GitActionParams, GitActionStrategy } from './git-action-strategy';

@Injectable()
export class CreateBranchGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'create_branch';
  private readonly logger = new Logger(CreateBranchGitActionStrategy.name);

  constructor(private readonly gitWorktreeService: GitWorktreeService) {}

  async execute({
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const repoPath = await this.gitWorktreeService.resolveProjectBasePath(
      triggerContext.repositoryId,
    );
    const branchName = resolveBranchValue(resolvedStepInputs.branch_name);
    const baseBranch = resolveBranchValue(
      resolvedStepInputs.base_branch,
      triggerContext.branchConfig?.baseBranch,
    );

    if (!branchName) {
      throw new Error(
        `Step ${stepId}: git_operation create_branch requires inputs.branch_name`,
      );
    }

    this.logger.log(
      `git_operation [${stepId}]: creating branch ${branchName} from ${baseBranch ?? 'default'} for repository ${triggerContext.repositoryId}`,
    );

    await this.gitWorktreeService.createBranch(
      repoPath,
      branchName,
      baseBranch,
    );

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: 'create_branch',
      },
      output: {
        ok: true,
        stepId,
        action: 'create_branch',
        branch_name: branchName,
        base_branch: baseBranch,
        repository_id: triggerContext.repositoryId,
      },
    };
  }
}
