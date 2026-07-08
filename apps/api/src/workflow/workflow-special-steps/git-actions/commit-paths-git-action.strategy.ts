import { Injectable, Logger } from '@nestjs/common';
import { GitCommitPathsService } from '../../../common/git/git-commit-paths.service';
import { GitWorktreeService } from '../../../common/git/git-worktree.service';
import {
  isNonEmptyStringArray,
  resolveCommitRepoPath,
} from '../step-git-operation-special-step.helpers';
import type { GitOperationAction } from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';
import type { GitActionParams, GitActionStrategy } from './git-action-strategy';

@Injectable()
export class CommitPathsGitActionStrategy implements GitActionStrategy {
  readonly action: GitOperationAction = 'commit_paths';
  private readonly logger = new Logger(CommitPathsGitActionStrategy.name);

  constructor(
    private readonly gitWorktreeService: GitWorktreeService,
    private readonly gitCommitPathsService: GitCommitPathsService,
  ) {}

  async execute({
    stepId,
    triggerContext,
    resolvedStepInputs,
  }: GitActionParams): Promise<SpecialStepHandlerResult> {
    const paths = resolvedStepInputs.paths;
    const message = resolvedStepInputs.message;

    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error(
        `Step ${stepId}: git_operation commit_paths requires inputs.paths as a non-empty array`,
      );
    }

    if (!isNonEmptyStringArray(paths)) {
      throw new Error(
        `Step ${stepId}: git_operation commit_paths requires inputs.paths to contain at least one non-empty string`,
      );
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new Error(
        `Step ${stepId}: git_operation commit_paths requires inputs.message as a non-empty string`,
      );
    }

    // Commit inside the provisioned worktree (its own branch) so artifacts never
    // land on the shared clone's default branch; clone-root fallback is reserved
    // for callers that deliberately operate without a worktree.
    const repoPath = await resolveCommitRepoPath(
      this.gitWorktreeService,
      stepId,
      triggerContext,
    );

    this.logger.log(
      `git_operation [${stepId}]: committing paths ${paths.join(', ')} for repository ${triggerContext.repositoryId}`,
    );

    const commitResult = await this.gitCommitPathsService.commitPaths({
      repoPath,
      paths: paths as string[],
      message: message,
      push: resolvedStepInputs.push === true,
    });

    return {
      result: {
        status: 'completed',
        mode: 'git_operation',
        action: 'commit_paths',
      },
      output: {
        ok: true,
        stepId,
        action: 'commit_paths',
        repository_id: triggerContext.repositoryId,
        committed: commitResult.committed,
        status: commitResult.status,
        changed_files: commitResult.changed_files,
        commit_sha: commitResult.commit_sha,
      },
    };
  }
}
