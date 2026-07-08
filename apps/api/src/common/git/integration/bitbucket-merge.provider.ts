import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BitbucketCredentialResolver } from './bitbucket-credential.resolver';
import { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import {
  HTTP_JSON_CLIENT,
  type HttpJsonClient,
} from './http-json-client.types';
import { parseRepositoryUrl } from './repository-url.parser';
import {
  mapBitbucketChecks,
  mapBitbucketMergeStrategy,
  mapBitbucketReviewDecision,
  mapBitbucketState,
} from './bitbucket-pull-request.mapper';
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from './merge-provider.interface';

const PROVIDER_KEY = 'bitbucket';
const API_BASE = 'https://api.bitbucket.org/2.0';
const TOKEN_SCHEME = 'basic-token' as const;

interface BitbucketPr {
  id: number;
  state: string;
  links: { html: { href: string } };
  merge_commit?: { hash: string } | null;
  source?: { commit?: { hash?: string } };
  participants?: { role: string; approved: boolean }[];
}

@Injectable()
export class BitbucketMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: BitbucketCredentialResolver,
    @Inject(HTTP_JSON_CLIENT) private readonly http: HttpJsonClient,
    private readonly trackingRepo: PullRequestTrackingRepository,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseRepositoryUrl(args.repositoryUrl);
    // OpenOrUpdatePullRequestArgs.githubSecretId is the neutral provider secret
    // id (Section 10.1 contract name); for Bitbucket it carries the BB token id.
    const token = await this.credentialResolver.resolveToken(
      args.githubSecretId,
    );
    const base = `${API_BASE}/repositories/${owner}/${repo}/pullrequests`;
    const query = `q=${encodeURIComponent(
      `source.branch.name="${args.headBranch}" AND destination.branch.name="${args.baseBranch}"`,
    )}&state=OPEN`;

    const existing = await this.http.request<{ values: BitbucketPr[] }>({
      method: 'GET',
      url: `${base}?${query}`,
      token,
      tokenScheme: TOKEN_SCHEME,
    });

    if (existing.data.values.length > 0) {
      const current = existing.data.values[0];
      const updated = await this.http.request<BitbucketPr>({
        method: 'PUT',
        url: `${base}/${current.id}`,
        token,
        tokenScheme: TOKEN_SCHEME,
        body: { title: args.title, description: args.body },
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await this.http.request<BitbucketPr>({
      method: 'POST',
      url: base,
      token,
      tokenScheme: TOKEN_SCHEME,
      body: {
        title: args.title,
        description: args.body,
        source: { branch: { name: args.headBranch } },
        destination: { branch: { name: args.baseBranch } },
      },
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const token = await this.tokenForRef(ref);
    const prUrl = `${API_BASE}/repositories/${ref.owner}/${ref.repo}/pullrequests/${ref.number}`;

    const pr = await this.http.request<BitbucketPr>({
      method: 'GET',
      url: prUrl,
      token,
      tokenScheme: TOKEN_SCHEME,
    });
    const statuses = await this.http.request<{ values: { state: string }[] }>({
      method: 'GET',
      url: `${prUrl}/statuses`,
      token,
      tokenScheme: TOKEN_SCHEME,
    });

    const state = mapBitbucketState(pr.data);
    return {
      ref,
      state,
      checks: mapBitbucketChecks(statuses.data.values),
      reviewDecision: mapBitbucketReviewDecision(pr.data.participants ?? []),
      mergeCommitSha:
        state === 'merged' ? (pr.data.merge_commit?.hash ?? null) : null,
      mergeable: state === 'open' ? null : false,
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const token = await this.tokenForRef(ref);
    const merged = await this.http.request<BitbucketPr>({
      method: 'POST',
      url: `${API_BASE}/repositories/${ref.owner}/${ref.repo}/pullrequests/${ref.number}/merge`,
      token,
      tokenScheme: TOKEN_SCHEME,
      body: { merge_strategy: mapBitbucketMergeStrategy(method) },
    });
    return { mergeCommitSha: merged.data.merge_commit?.hash ?? '' };
  }

  /**
   * The canonical {@link MergeProvider} status/merge signatures pass only a
   * {@link PullRequestRef}. The Phase-3 `pull_request_tracking` row stores the
   * provider secret id alongside the ref identity (mirrors GitHubMergeProvider),
   * so resolve credentials from that row and fail fast when none exists.
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

  private toRef(owner: string, repo: string, pr: BitbucketPr): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: pr.id,
      url: pr.links.html.href,
    };
  }
}
