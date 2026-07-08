import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { PullRequestTracking } from './pull-request-tracking.entity';
import type { RecordOpenedPullRequestInput } from './pull-request-tracking.repository.types';

/**
 * Persistence surface for `pull_request_tracking`. `recordOpenedPullRequest` is
 * find-or-create on the unique `(provider, owner, repo, pr_number)` identity so a
 * re-run of `merge_integrate` for the same head updates the row in place instead
 * of duplicating it. Neutral throughout — no downstream domain identifiers.
 */
@Injectable()
export class PullRequestTrackingRepository {
  constructor(
    @InjectRepository(PullRequestTracking)
    private readonly repository: Repository<PullRequestTracking>,
  ) {}

  async recordOpenedPullRequest(
    input: RecordOpenedPullRequestInput,
  ): Promise<PullRequestTracking> {
    const existing = await this.findByProviderIdentity(
      input.provider,
      input.owner,
      input.repo,
      input.prNumber,
    );

    if (existing) {
      existing.scope_id = input.scopeId;
      existing.context_id = input.contextId;
      existing.workflow_run_id = input.workflowRunId;
      existing.head_branch = input.headBranch;
      existing.base_branch = input.baseBranch;
      existing.pr_url = input.prUrl;
      existing.github_secret_id = input.githubSecretId;
      existing.repository_url = input.repositoryUrl;
      existing.auto_merge = input.autoMerge;
      existing.merge_method = input.mergeMethod;
      existing.state = 'open';
      return this.repository.save(existing);
    }

    const created = this.repository.create({
      provider: input.provider,
      owner: input.owner,
      repo: input.repo,
      pr_number: input.prNumber,
      scope_id: input.scopeId,
      context_id: input.contextId,
      workflow_run_id: input.workflowRunId,
      head_branch: input.headBranch,
      base_branch: input.baseBranch,
      pr_url: input.prUrl,
      github_secret_id: input.githubSecretId,
      repository_url: input.repositoryUrl,
      auto_merge: input.autoMerge,
      merge_method: input.mergeMethod,
      state: 'open',
      merge_commit_sha: null,
    });
    return this.repository.save(created);
  }

  findByProviderIdentity(
    provider: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestTracking | null> {
    return this.repository.findOne({
      where: { provider, owner, repo, pr_number: prNumber },
    });
  }

  findOpen(): Promise<PullRequestTracking[]> {
    return this.repository.find({ where: { state: 'open' } });
  }

  /**
   * Atomically flip an open row to merged via a conditional UPDATE so exactly one
   * caller wins when a webhook and the poll reconciler process the same merge
   * concurrently. The database evaluates `WHERE id AND state='open'` and the
   * affected-row count is the authoritative race outcome: `affected === 1` means
   * this caller performed the transition (`alreadyMerged: false`), `affected === 0`
   * means someone else already merged it (or no open row exists) so this caller
   * must not re-emit (`alreadyMerged: true`). This replaces the previous
   * non-atomic find→check→save read-modify-write, under which both racers could
   * read `state='open'` and both emit `core.integration.pr_merged.v1`.
   */
  async markMerged(
    id: string,
    mergeCommitSha: string,
  ): Promise<{ alreadyMerged: boolean; row: PullRequestTracking }> {
    const result = await this.repository.update(
      { id, state: 'open' },
      { state: 'merged', merge_commit_sha: mergeCommitSha },
    );
    const row = await this.repository.findOneOrFail({ where: { id } });
    return { alreadyMerged: result.affected === 0, row };
  }
}
