import { Injectable, Logger } from '@nestjs/common';
import { GitMergeService } from '../../../common/git/git-merge.service';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import type { GitActionParams, GitActionStrategy } from './git-action-strategy';
import { MergeBranchResolverService } from './merge-branch-resolver.service';

/**
 * Single-stage merge: worktree merge + clone-root integration push in one call.
 * Retained for workflows (e.g. design ingestion) that merge artifacts without an
 * in-container quality gate. The gated auto-merge path uses the split
 * `merge_prepare` + `merge_integrate` actions instead.
 */
@Injectable()
export class MergeGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'merge';
  private readonly logger = new Logger(MergeGitActionStrategy.name);

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
      `git_operation [${stepId}]: merging ${targetBranch} into ${baseBranch} for repository ${triggerContext.repositoryId} (worktree ${worktreePath})`,
    );

    const mergeResult = await this.gitMergeService.mergeWithConflictDetection(
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
        quality_gate_log: mergeResult.qualityGateLog,
        baseMergeCommit: mergeResult.baseMergeCommit,
        mergeCommit: mergeResult.mergeCommit,
        repository_id: triggerContext.repositoryId,
        worktree_id: triggerContext.worktreeId,
      },
    };
  }
}
