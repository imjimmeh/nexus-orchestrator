import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Octokit } from '@octokit/rest';
import { GitHubCredentialResolver } from './github-credential.resolver';
import { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import {
  GITHUB_OCTOKIT_FACTORY,
  type OctokitFactory,
} from './github-octokit.factory.types';
import { parseGitHubRepositoryUrl } from './github-repository-url.parser';
import {
  mapChecksStatus,
  mapPullRequestState,
  mapReviewDecision,
} from './github-pull-request.mapper';
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from './merge-provider.interface';

const PROVIDER_KEY = 'github';

const AUTO_MERGE_METHOD: Record<MergeMethod, 'MERGE' | 'SQUASH' | 'REBASE'> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE',
};

const RESOLVE_PULL_REQUEST_NODE_ID_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { id }
  }
}`;

const ENABLE_AUTO_MERGE_MUTATION = `mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
    pullRequest { id }
  }
}`;

interface PullRequestNodeIdResult {
  repository: { pullRequest: { id: string } | null } | null;
}

@Injectable()
export class GitHubMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: GitHubCredentialResolver,
    @Inject(GITHUB_OCTOKIT_FACTORY)
    private readonly octokitFactory: OctokitFactory,
    private readonly trackingRepo: PullRequestTrackingRepository,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseGitHubRepositoryUrl(args.repositoryUrl);
    const octokit = await this.authedClient(args.githubSecretId);

    const existing = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${args.headBranch}`,
      base: args.baseBranch,
    });

    if (existing.data.length > 0) {
      const current = existing.data[0];
      const updated = await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: current.number,
        title: args.title,
        body: args.body,
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await octokit.rest.pulls.create({
      owner,
      repo,
      head: args.headBranch,
      base: args.baseBranch,
      title: args.title,
      body: args.body,
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const octokit = await this.authedClientForRef(ref);
    const { owner, repo, number } = ref;

    const pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });

    const [checkRuns, reviews] = await Promise.all([
      octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: pr.data.head.sha,
      }),
      octokit.rest.pulls.listReviews({ owner, repo, pull_number: number }),
    ]);

    const state = mapPullRequestState({
      state: pr.data.state,
      merged: pr.data.merged,
    });

    return {
      ref,
      state,
      checks: mapChecksStatus(checkRuns.data.check_runs),
      reviewDecision: mapReviewDecision(reviews.data),
      mergeCommitSha:
        state === 'merged' ? (pr.data.merge_commit_sha ?? null) : null,
      mergeable: pr.data.mergeable ?? null,
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const octokit = await this.authedClientForRef(ref);
    const merged = await octokit.rest.pulls.merge({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      merge_method: method,
    });
    return { mergeCommitSha: merged.data.sha };
  }

  async enableAutoMerge(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<void> {
    const octokit = await this.authedClientForRef(ref);
    const result = await octokit.graphql<PullRequestNodeIdResult>(
      RESOLVE_PULL_REQUEST_NODE_ID_QUERY,
      { owner: ref.owner, repo: ref.repo, number: ref.number },
    );
    const pullRequestId = result.repository?.pullRequest?.id;
    if (!pullRequestId) {
      throw new NotFoundException(
        `Cannot resolve GraphQL node id for ${ref.provider} ${ref.owner}/${ref.repo}#${ref.number}; cannot enable auto-merge`,
      );
    }
    await octokit.graphql(ENABLE_AUTO_MERGE_MUTATION, {
      pullRequestId,
      mergeMethod: AUTO_MERGE_METHOD[method],
    });
  }

  /**
   * Build an authenticated octokit client for the open/update path, where the
   * `github_secret_id` is carried directly on the request arguments.
   */
  private async authedClient(githubSecretId: string): Promise<Octokit> {
    const token = await this.credentialResolver.resolveToken(githubSecretId);
    return this.octokitFactory(token);
  }

  /**
   * Build an authenticated octokit client for the status/merge paths. The
   * canonical {@link MergeProvider} signatures pass only a {@link PullRequestRef}
   * (no secret id). The Phase-3 `pull_request_tracking` row stores the
   * `github_secret_id` alongside the ref identity, so this resolves the secret by
   * looking the row up by `(provider, owner, repo, number)` and fails fast when no
   * such row exists rather than authenticating with the wrong credential.
   */
  private async authedClientForRef(ref: PullRequestRef): Promise<Octokit> {
    const token = await this.credentialResolver.resolveToken(
      await this.secretIdForRef(ref),
    );
    return this.octokitFactory(token);
  }

  private async secretIdForRef(ref: PullRequestRef): Promise<string> {
    const row = await this.trackingRepo.findByProviderIdentity(
      ref.provider,
      ref.owner,
      ref.repo,
      ref.number,
    );
    if (!row) {
      throw new NotFoundException(
        `No pull_request_tracking row for ${ref.provider} ${ref.owner}/${ref.repo}#${ref.number}; cannot resolve credentials`,
      );
    }
    return row.github_secret_id;
  }

  private toRef(
    owner: string,
    repo: string,
    data: { number: number; html_url: string },
  ): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: data.number,
      url: data.html_url,
    };
  }
}
