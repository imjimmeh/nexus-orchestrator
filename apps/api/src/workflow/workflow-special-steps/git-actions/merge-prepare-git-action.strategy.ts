import { Injectable, Logger } from '@nestjs/common';
import { GitMergeService } from '../../../common/git/git-merge.service';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import type { GitActionParams, GitActionStrategy } from './git-action-strategy';
import { MergeBranchResolverService } from './merge-branch-resolver.service';

/**
 * Stage 1 of the auto-merge: merge the base into the context worktree only. No
 * integration push happens here, so the resulting worktree tree is exactly what
 * a downstream in-container quality gate validates before the integration push.
 */
@Injectable()
export class MergePrepareGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'merge_prepare';
  private readonly logger = new Logger(MergePrepareGitActionStrategy.name);

  constructor(
    private readonly gitMergeService: GitMergeService,
    private readonly branchResolver: MergeBranchResolverService,
  ) {}

  async execute({
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const { baseBranch, targetBranch, worktreePath } =
      await this.branchResolver.resolve(
        stepId,
        this.action,
        triggerContext,
        resolvedStepInputs,
      );

    this.logger.log(
      `git_operation [${stepId}]: preparing worktree merge of ${baseBranch} into ${targetBranch} for repository ${triggerContext.repositoryId} (worktree ${worktreePath})`,
    );

    const mergeResult = await this.gitMergeService.prepareMergeInWorktree(
      triggerContext.repositoryId,
      targetBranch,
      baseBranch,
      worktreePath,
    );

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: this.action,
      },
      output: {
        ok: mergeResult.outcome === 'succeeded',
        stepId,
        action: this.action,
        merge_outcome: mergeResult.outcome,
        merge_message: mergeResult.message,
        auth_error_class: mergeResult.authErrorClass,
        base_branch: baseBranch,
        target_branch: targetBranch,
        source_branch: mergeResult.sourceBranch,
        destination_branch: mergeResult.destinationBranch,
        conflicted_files: mergeResult.conflictedFiles,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }
}
