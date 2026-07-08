import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabMergeProvider } from './gitlab-merge.provider';
import type { GitLabCredentialResolver } from './gitlab-credential.resolver';
import type { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import type { HttpJsonClient, HttpJsonRequest } from './http-json-client.types';
import type { OpenOrUpdatePullRequestArgs } from './merge-provider.interface';

const TOKEN = 'glpat-secret';
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: 'scope-1',
  contextId: 'ctx-1',
  workflowRunId: 'run-1',
  repositoryUrl: 'https://gitlab.com/acme/widgets.git',
  githubSecretId: 'sec-gl-1', // neutral provider secret id (GitLab token here)
  headBranch: 'feature/x',
  baseBranch: 'main',
  title: 'Feature X',
  body: 'Implements X',
};

/**
 * Route mock by (method, url-substring) — returns canned MR/pipeline/approval
 * shapes. No network.
 */
function buildClient(
  routes: {
    match: (r: HttpJsonRequest) => boolean;
    data: unknown;
    status?: number;
  }[],
) {
  const request = vi.fn(async (r: HttpJsonRequest) => {
    const route = routes.find((entry) => entry.match(r));
    if (!route) {
      throw new Error(`unrouted ${r.method} ${r.url}`);
    }
    return { status: route.status ?? 200, data: route.data };
  });
  return { client: { request } as unknown as HttpJsonClient, request };
}

function buildProvider(client: HttpJsonClient) {
  const credentialResolver = {
    resolveToken: vi.fn(async () => TOKEN),
  } as unknown as GitLabCredentialResolver;
  // The status/merge paths resolve the secret id from the Phase-3 tracking row
  // by provider identity (mirrors the merged GitHubMergeProvider). The row's
  // github_secret_id column is the neutral provider secret id.
  const trackingRepo = {
    findByProviderIdentity: vi.fn(async () => ({
      github_secret_id: 'sec-gl-1',
    })),
  } as unknown as PullRequestTrackingRepository;
  return {
    provider: new GitLabMergeProvider(credentialResolver, client, trackingRepo),
    credentialResolver,
    trackingRepo,
  };
}

const REF = {
  provider: 'gitlab',
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
};

describe('GitLabMergeProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "gitlab"', () => {
    const { client } = buildClient([]);
    expect(buildProvider(client).provider.providerKey).toBe('gitlab');
  });

  it('creates an MR when none exists for the source/target branches', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.includes('/merge_requests?'),
        data: [],
      },
      {
        match: (r) => r.method === 'POST' && r.url.endsWith('/merge_requests'),
        data: {
          iid: 42,
          web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/42',
        },
      },
    ]);
    const { provider } = buildProvider(client);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    const post = request.mock.calls.find(([r]) => r.method === 'POST')![0];
    expect(post.body).toEqual(
      expect.objectContaining({
        source_branch: 'feature/x',
        target_branch: 'main',
        title: 'Feature X',
      }),
    );
    expect(ref).toEqual({
      provider: 'gitlab',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://gitlab.com/acme/widgets/-/merge_requests/42',
    });
  });

  it('is idempotent: a second call updates the existing MR (no duplicate)', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.includes('/merge_requests?'),
        data: [{ iid: 7, web_url: REF.url }],
      },
      { match: (r) => r.method === 'PUT', data: { iid: 7, web_url: REF.url } },
    ]);
    const { provider } = buildProvider(client);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
    expect(request.mock.calls.filter(([r]) => r.method === 'PUT')).toHaveLength(
      2,
    );
    expect(first).toEqual(second);
    expect(second.number).toBe(7);
  });

  it('maps MR + pipeline + approvals into PullRequestStatus', async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.endsWith('/merge_requests/7'),
        data: {
          state: 'opened',
          merge_status: 'can_be_merged',
          merge_commit_sha: null,
        },
      },
      {
        match: (r) => r.url.includes('/merge_requests/7/pipelines'),
        data: [{ status: 'success' }],
      },
      {
        match: (r) => r.url.includes('/merge_requests/7/approvals'),
        data: { approved: true, approvals_required: 1, approvals_left: 0 },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe('open');
    expect(status.checks).toBe('passing');
    expect(status.reviewDecision).toBe('approved');
    expect(status.mergeable).toBe(true);
    expect(status.mergeCommitSha).toBeNull();
  });

  it('reports the merge commit sha when the MR is merged', async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.endsWith('/merge_requests/7'),
        data: {
          state: 'merged',
          merge_status: 'can_be_merged',
          merge_commit_sha: 'deadbeef',
        },
      },
      { match: (r) => r.url.includes('/pipelines'), data: [] },
      {
        match: (r) => r.url.includes('/approvals'),
        data: { approved: false, approvals_required: 0, approvals_left: 0 },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe('merged');
    expect(status.mergeCommitSha).toBe('deadbeef');
  });

  it('merges an MR with the requested merge method (squash)', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'PUT' && r.url.endsWith('/merge'),
        data: { merge_commit_sha: 'mergedsha' },
      },
    ]);
    const { provider } = buildProvider(client);

    const result = await provider.mergePullRequest(REF, 'squash');

    const put = request.mock.calls.find(([r]) => r.method === 'PUT')![0];
    expect(put.body).toEqual(expect.objectContaining({ squash: true }));
    expect(result).toEqual({ mergeCommitSha: 'mergedsha' });
  });

  it('never includes the token in an error when the HTTP client fails', async () => {
    const request = vi.fn(async () => {
      throw new Error('HTTP 403 from GET /api/v4/projects');
    });
    const { provider } = buildProvider({
      request,
    });

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
