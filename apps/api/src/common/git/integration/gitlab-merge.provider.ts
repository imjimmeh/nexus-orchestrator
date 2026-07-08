import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GitLabCredentialResolver } from './gitlab-credential.resolver';
import { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import {
  HTTP_JSON_CLIENT,
  type HttpJsonClient,
} from './http-json-client.types';
import { parseRepositoryUrl } from './repository-url.parser';
import {
  mapGitlabChecks,
  mapGitlabMergeMethod,
  mapGitlabReviewDecision,
  mapGitlabState,
} from './gitlab-merge-request.mapper';
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from './merge-provider.interface';

const PROVIDER_KEY = 'gitlab';
const API_BASE = 'https://gitlab.com/api/v4';

interface GitlabMr {
  iid: number;
  web_url: string;
  state: string;
  merge_status?: string;
  merge_commit_sha?: string | null;
  sha?: string | null;
}

@Injectable()
export class GitLabMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: GitLabCredentialResolver,
    @Inject(HTTP_JSON_CLIENT) private readonly http: HttpJsonClient,
    private readonly trackingRepo: PullRequestTrackingRepository,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseRepositoryUrl(args.repositoryUrl);
    // OpenOrUpdatePullRequestArgs.githubSecretId is the neutral provider secret
    // id (Section 10.1 contract name); for GitLab it carries the GitLab token id.
    const token = await this.credentialResolver.resolveToken(
      args.githubSecretId,
    );
    const project = this.projectPath(owner, repo);

    const existing = await this.http.request<GitlabMr[]>({
      method: 'GET',
      url: `${API_BASE}/projects/${project}/merge_requests?state=opened&source_branch=${encodeURIComponent(args.headBranch)}&target_branch=${encodeURIComponent(args.baseBranch)}`,
      token,
    });

    if (existing.data.length > 0) {
      const current = existing.data[0];
      const updated = await this.http.request<GitlabMr>({
        method: 'PUT',
        url: `${API_BASE}/projects/${project}/merge_requests/${current.iid}`,
        token,
        body: { title: args.title, description: args.body },
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await this.http.request<GitlabMr>({
      method: 'POST',
      url: `${API_BASE}/projects/${project}/merge_requests`,
      token,
      body: {
        source_branch: args.headBranch,
        target_branch: args.baseBranch,
        title: args.title,
        description: args.body,
      },
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const token = await this.tokenForRef(ref);
    const project = this.projectPath(ref.owner, ref.repo);
    const base = `${API_BASE}/projects/${project}/merge_requests/${ref.number}`;

    const [mr, pipelines, approvals] = await Promise.all([
      this.http.request<GitlabMr>({ method: 'GET', url: base, token }),
      this.http.request<{ status: string }[]>({
        method: 'GET',
        url: `${base}/pipelines`,
        token,
      }),
      this.http.request<{
        approved: boolean;
        approvals_required: number;
        approvals_left: number;
      }>({
        method: 'GET',
        url: `${base}/approvals`,
        token,
      }),
    ]);

    const state = mapGitlabState(mr.data);
    const latestPipeline = pipelines.data.length > 0 ? pipelines.data[0] : null;

    return {
      ref,
      state,
      checks: mapGitlabChecks(latestPipeline),
      reviewDecision: mapGitlabReviewDecision(approvals.data),
      mergeCommitSha:
        state === 'merged' ? (mr.data.merge_commit_sha ?? null) : null,
      mergeable: mr.data.merge_status === 'can_be_merged',
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const token = await this.tokenForRef(ref);
    const project = this.projectPath(ref.owner, ref.repo);
    const merged = await this.http.request<GitlabMr>({
      method: 'PUT',
      url: `${API_BASE}/projects/${project}/merge_requests/${ref.number}/merge`,
      token,
      body: mapGitlabMergeMethod(method),
    });
    return {
      mergeCommitSha: merged.data.merge_commit_sha ?? merged.data.sha ?? '',
    };
  }

  /**
   * The canonical {@link MergeProvider} status/merge signatures pass only a
   * {@link PullRequestRef} (no secret id). The Phase-3 `pull_request_tracking`
   * row stores the provider secret id alongside the ref identity, so this looks
   * the row up by `(provider, owner, repo, number)` and fails fast when none
   * exists rather than authenticating with the wrong credential.
   */
  private async tokenForRef(ref: PullRequestRef): Promise<string> {
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
    return this.credentialResolver.resolveToken(row.github_secret_id);
  }

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  private toRef(owner: string, repo: string, mr: GitlabMr): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: mr.iid,
      url: mr.web_url,
    };
  }
}
