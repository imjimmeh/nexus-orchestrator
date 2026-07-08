import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BitbucketMergeProvider } from './bitbucket-merge.provider';
import type { BitbucketCredentialResolver } from './bitbucket-credential.resolver';
import type { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import type { HttpJsonClient, HttpJsonRequest } from './http-json-client.types';
import type { OpenOrUpdatePullRequestArgs } from './merge-provider.interface';

const TOKEN = 'bbtoken-secret';
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: 'scope-1',
  contextId: 'ctx-1',
  workflowRunId: 'run-1',
  repositoryUrl: 'https://bitbucket.org/acme/widgets.git',
  githubSecretId: 'sec-bb-1',
  headBranch: 'feature/x',
  baseBranch: 'main',
  title: 'Feature X',
  body: 'Implements X',
};

const REF = {
  provider: 'bitbucket',
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  url: 'https://bitbucket.org/acme/widgets/pull-requests/7',
};

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
  } as unknown as BitbucketCredentialResolver;
  const trackingRepo = {
    findByProviderIdentity: vi.fn(async () => ({
      github_secret_id: 'sec-bb-1',
    })),
  } as unknown as PullRequestTrackingRepository;
  return {
    provider: new BitbucketMergeProvider(
      credentialResolver,
      client,
      trackingRepo,
    ),
  };
}

describe('BitbucketMergeProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "bitbucket"', () => {
    const { client } = buildClient([]);
    expect(buildProvider(client).provider.providerKey).toBe('bitbucket');
  });

  it('creates a PR when none exists for the source/destination branches', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.includes('/pullrequests?'),
        data: { values: [] },
      },
      {
        match: (r) => r.method === 'POST' && r.url.endsWith('/pullrequests'),
        data: {
          id: 42,
          links: {
            html: {
              href: 'https://bitbucket.org/acme/widgets/pull-requests/42',
            },
          },
        },
      },
    ]);
    const { provider } = buildProvider(client);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    const post = request.mock.calls.find(([r]) => r.method === 'POST')![0];
    expect(post.tokenScheme).toBe('basic-token');
    expect(post.body).toEqual(
      expect.objectContaining({
        title: 'Feature X',
        source: { branch: { name: 'feature/x' } },
        destination: { branch: { name: 'main' } },
      }),
    );
    expect(ref).toEqual({
      provider: 'bitbucket',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://bitbucket.org/acme/widgets/pull-requests/42',
    });
  });

  it('is idempotent: a second call updates the existing PR (no duplicate)', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.includes('/pullrequests?'),
        data: { values: [{ id: 7, links: { html: { href: REF.url } } }] },
      },
      {
        match: (r) => r.method === 'PUT',
        data: { id: 7, links: { html: { href: REF.url } } },
      },
    ]);
    const { provider } = buildProvider(client);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
    expect(request.mock.calls.filter(([r]) => r.method === 'PUT')).toHaveLength(
      2,
    );
    expect(first).toEqual(second);
  });

  it('maps PR + build statuses + participants into PullRequestStatus', async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.endsWith('/pullrequests/7'),
        data: {
          state: 'OPEN',
          merge_commit: null,
          source: { commit: { hash: 'srcsha' } },
          participants: [{ role: 'REVIEWER', approved: true }],
        },
      },
      {
        match: (r) => r.url.includes('/statuses'),
        data: { values: [{ state: 'SUCCESSFUL' }] },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe('open');
    expect(status.checks).toBe('passing');
    expect(status.reviewDecision).toBe('approved');
    expect(status.mergeCommitSha).toBeNull();
  });

  it('reports the merge commit hash when the PR is merged', async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === 'GET' && r.url.endsWith('/pullrequests/7'),
        data: {
          state: 'MERGED',
          merge_commit: { hash: 'deadbeef' },
          source: { commit: { hash: 'srcsha' } },
          participants: [],
        },
      },
      { match: (r) => r.url.includes('/statuses'), data: { values: [] } },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe('merged');
    expect(status.mergeCommitSha).toBe('deadbeef');
  });

  it('merges a PR with the requested merge strategy (squash)', async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === 'POST' && r.url.endsWith('/merge'),
        data: { merge_commit: { hash: 'mergedsha' } },
      },
    ]);
    const { provider } = buildProvider(client);

    const result = await provider.mergePullRequest(REF, 'squash');

    const post = request.mock.calls.find(([r]) => r.method === 'POST')![0];
    expect(post.body).toEqual(
      expect.objectContaining({ merge_strategy: 'squash' }),
    );
    expect(result).toEqual({ mergeCommitSha: 'mergedsha' });
  });

  it('never includes the token in an error when the HTTP client fails', async () => {
    const request = vi.fn(async () => {
      throw new Error('HTTP 403 from GET /repositories');
    });
    const { provider } = buildProvider({
      request,
    });

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
