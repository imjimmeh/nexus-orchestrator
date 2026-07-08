import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
} from './merge-provider.interface';
import { GitHubMergeProvider } from './github-merge.provider';
import { GitLabMergeProvider } from './gitlab-merge.provider';
import { BitbucketMergeProvider } from './bitbucket-merge.provider';
import type { HttpJsonClient, HttpJsonRequest } from './http-json-client.types';
import type { PullRequestTrackingRepository } from './pull-request-tracking.repository';

const ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: 'scope-1',
  contextId: 'ctx-1',
  workflowRunId: 'run-1',
  repositoryUrl: '', // set per-case
  githubSecretId: 'sec-1',
  headBranch: 'feature/x',
  baseBranch: 'main',
  title: 'Feature X',
  body: 'Implements X',
};

const MERGED_REF: PullRequestRef = {
  provider: '', // set per-case
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  url: 'https://example/pull/7',
};

interface ContractCase {
  name: string;
  providerKey: string;
  repositoryUrl: string;
  build(): MergeProvider;
}

/** A tracking repo that always resolves a secret id for the status/merge paths. */
function stubTrackingRepo(): PullRequestTrackingRepository {
  return {
    findByProviderIdentity: vi.fn(async () => ({ github_secret_id: 'sec-1' })),
  } as unknown as PullRequestTrackingRepository;
}

/** Stateful HTTP mock: first list is empty (create), subsequent lists return the PR (update). */
function statefulHttp(
  makeRoutes: (state: { created: boolean }) => (r: HttpJsonRequest) => unknown,
): HttpJsonClient {
  const state = { created: false };
  return {
    request: vi.fn(async (r: HttpJsonRequest) => {
      const data = makeRoutes(state)(r);
      return { status: 200, data };
    }),
  } as unknown as HttpJsonClient;
}

const cases: ContractCase[] = [
  {
    name: 'github',
    providerKey: 'github',
    repositoryUrl: 'https://github.com/acme/widgets.git',
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => 'gh-token'),
      };
      let created = false;
      const pulls = {
        list: vi.fn(async () =>
          created
            ? {
                data: [
                  {
                    number: 7,
                    html_url: 'https://github.com/acme/widgets/pull/7',
                  },
                ],
              }
            : { data: [] },
        ),
        create: vi.fn(async () => {
          created = true;
          return {
            data: {
              number: 7,
              html_url: 'https://github.com/acme/widgets/pull/7',
            },
          };
        }),
        update: vi.fn(async () => ({
          data: {
            number: 7,
            html_url: 'https://github.com/acme/widgets/pull/7',
          },
        })),
        get: vi.fn(async () => ({
          data: {
            state: 'closed',
            merged: true,
            mergeable: null,
            merge_commit_sha: 'mergedsha',
            head: { sha: 'h' },
          },
        })),
        listReviews: vi.fn(async () => ({ data: [] })),
        merge: vi.fn(async () => ({ data: { sha: 'mergedsha' } })),
      };
      const checks = {
        listForRef: vi.fn(async () => ({ data: { check_runs: [] } })),
      };
      const octokitFactory = vi.fn(() => ({ rest: { pulls, checks } }));
      return new GitHubMergeProvider(
        credentialResolver as never,
        octokitFactory as never,
        stubTrackingRepo(),
      );
    },
  },
  {
    name: 'gitlab',
    providerKey: 'gitlab',
    repositoryUrl: 'https://gitlab.com/acme/widgets.git',
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => 'gl-token'),
      };
      const http = statefulHttp((state) => (r) => {
        if (r.method === 'GET' && r.url.includes('/merge_requests?')) {
          return state.created
            ? [
                {
                  iid: 7,
                  web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
                },
              ]
            : [];
        }
        if (r.method === 'POST') {
          state.created = true;
          return {
            iid: 7,
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
          };
        }
        if (r.method === 'PUT' && r.url.endsWith('/merge')) {
          return { merge_commit_sha: 'mergedsha' };
        }
        if (r.method === 'PUT') {
          return {
            iid: 7,
            web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
          };
        }
        if (r.url.endsWith('/merge_requests/7')) {
          return {
            state: 'merged',
            merge_status: 'can_be_merged',
            merge_commit_sha: 'mergedsha',
          };
        }
        if (r.url.includes('/pipelines')) return [];
        if (r.url.includes('/approvals'))
          return { approved: false, approvals_required: 0, approvals_left: 0 };
        return {};
      });
      return new GitLabMergeProvider(
        credentialResolver as never,
        http,
        stubTrackingRepo(),
      );
    },
  },
  {
    name: 'bitbucket',
    providerKey: 'bitbucket',
    repositoryUrl: 'https://bitbucket.org/acme/widgets.git',
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => 'bb-token'),
      };
      const http = statefulHttp((state) => (r) => {
        if (r.method === 'GET' && r.url.includes('/pullrequests?')) {
          return state.created
            ? {
                values: [
                  {
                    id: 7,
                    links: {
                      html: {
                        href: 'https://bitbucket.org/acme/widgets/pull-requests/7',
                      },
                    },
                  },
                ],
              }
            : { values: [] };
        }
        if (r.method === 'POST' && r.url.endsWith('/pullrequests')) {
          state.created = true;
          return {
            id: 7,
            links: {
              html: {
                href: 'https://bitbucket.org/acme/widgets/pull-requests/7',
              },
            },
          };
        }
        if (r.method === 'POST' && r.url.endsWith('/merge')) {
          return { merge_commit: { hash: 'mergedsha' } };
        }
        if (r.method === 'PUT') {
          return {
            id: 7,
            links: {
              html: {
                href: 'https://bitbucket.org/acme/widgets/pull-requests/7',
              },
            },
          };
        }
        if (r.url.endsWith('/pullrequests/7')) {
          return {
            state: 'MERGED',
            merge_commit: { hash: 'mergedsha' },
            source: { commit: { hash: 's' } },
            participants: [],
          };
        }
        if (r.url.includes('/statuses')) return { values: [] };
        return {};
      });
      return new BitbucketMergeProvider(
        credentialResolver as never,
        http,
        stubTrackingRepo(),
      );
    },
  },
];

describe.each(cases)('MergeProvider contract: $name', (testCase) => {
  let provider: MergeProvider;
  beforeEach(() => {
    vi.clearAllMocks();
    provider = testCase.build();
  });

  it('exposes the expected providerKey', () => {
    expect(provider.providerKey).toBe(testCase.providerKey);
  });

  it('opens a PR returning a ref tagged with the provider', async () => {
    const ref = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    expect(ref.provider).toBe(testCase.providerKey);
    expect(ref.number).toBe(7);
    expect(ref.url).toContain('7');
  });

  it('is idempotent: a second open updates rather than duplicates', async () => {
    const first = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    const second = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    expect(second).toEqual(first);
  });

  it('reports a merged PR with a merge commit sha', async () => {
    const status = await provider.getPullRequestStatus({
      ...MERGED_REF,
      provider: testCase.providerKey,
    });
    expect(status.state).toBe('merged');
    expect(status.mergeCommitSha).toBe('mergedsha');
  });

  it('merges a PR returning a merge commit sha', async () => {
    const result = await provider.mergePullRequest(
      { ...MERGED_REF, provider: testCase.providerKey },
      'squash',
    );
    expect(result.mergeCommitSha).toBe('mergedsha');
  });
});
