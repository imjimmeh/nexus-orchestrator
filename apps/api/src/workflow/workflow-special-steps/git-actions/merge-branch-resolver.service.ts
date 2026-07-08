import { Injectable, Logger } from '@nestjs/common';
import { GitWorktreeService } from '../../../common/git/git-worktree.service';
import {
  isWorktreePathForId,
  requireWorktreeId,
  resolveBranchValue,
  resolveMergeWorktreePath,
} from '../step-git-operation-special-step.helpers';
import type { TriggerContext } from '../step-git-operation-special-step.types';
import type { ResolvedMergeBranches } from './merge-branch-resolver.types';

/**
 * Shared branch/worktree resolution for the merge-family git actions
 * (`merge_prepare` and `merge_integrate`). Both stages must resolve the SAME
 * base/target branch and worktree path so the gate and the integration push act
 * on a single consistent tree; centralising the logic here keeps them in lockstep.
 */
@Injectable()
export class MergeBranchResolverService {
  private readonly defaultBaseBranch = 'main';
  private readonly logger = new Logger(MergeBranchResolverService.name);

  constructor(private readonly gitWorktreeService: GitWorktreeService) {}

  async resolve(
    stepId: string,
    action: string,
    triggerContext: TriggerContext,
    resolvedStepInputs: Record<string, unknown>,
  ): Promise<ResolvedMergeBranches> {
    const inferredBase = await this.inferBaseBranch(
      triggerContext.repositoryId,
    );
    const baseBranch = resolveBranchValue(
      resolvedStepInputs.base_branch,
      triggerContext.branchConfig?.baseBranch,
      inferredBase,
    );
    const rawTargetBranch = resolveBranchValue(
      resolvedStepInputs.target_branch,
      triggerContext.branchConfig?.targetBranch,
    );

    if (!baseBranch || !rawTargetBranch) {
      throw new Error(
        `Step ${stepId}: git_operation ${action} requires base_branch and target_branch`,
      );
    }

    const worktreeId = requireWorktreeId(stepId, action, triggerContext);
    const normalizedTargetBranch = this.normalizeTargetBranch({
      baseBranch,
      targetBranch: rawTargetBranch,
      worktreeId,
      stepId,
      repositoryId: triggerContext.repositoryId,
    });
    const targetBranch = await this.resolveActualWorktreeBranch({
      configuredTargetBranch: normalizedTargetBranch,
      repositoryId: triggerContext.repositoryId,
      stepId,
      worktreeId,
    });

    const worktreePath = await resolveMergeWorktreePath(
      this.gitWorktreeService,
      triggerContext.repositoryId,
      worktreeId,
      baseBranch,
      targetBranch,
    );

    return { baseBranch, targetBranch, worktreeId, worktreePath };
  }

  private async resolveActualWorktreeBranch(params: {
    configuredTargetBranch: string;
    repositoryId: string;
    stepId: string;
    worktreeId: string;
  }): Promise<string> {
    try {
      const worktrees = await this.gitWorktreeService.listManagedWorktrees(
        params.repositoryId,
      );
      const matchingWorktree = worktrees.find(
        (entry) =>
          typeof entry.branch === 'string' &&
          isWorktreePathForId(entry.path, params.worktreeId),
      );
      const actualBranch = matchingWorktree?.branch?.trim();
      if (!actualBranch || actualBranch === params.configuredTargetBranch) {
        return params.configuredTargetBranch;
      }

      this.logger.warn(
        `git_operation [${params.stepId}]: configured target branch ${params.configuredTargetBranch} differed from managed worktree branch ${actualBranch} for ${params.repositoryId}/${params.worktreeId}; using managed worktree branch`,
      );
      return actualBranch;
    } catch (error) {
      this.logger.warn(
        `git_operation [${params.stepId}]: unable to inspect managed worktree branch for ${params.repositoryId}/${params.worktreeId}; using configured target branch ${params.configuredTargetBranch}: ${(error as Error).message}`,
      );
      return params.configuredTargetBranch;
    }
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
