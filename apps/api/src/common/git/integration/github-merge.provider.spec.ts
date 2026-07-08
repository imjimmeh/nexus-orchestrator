import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubMergeProvider } from './github-merge.provider';
import type { GitHubCredentialResolver } from './github-credential.resolver';
import type { OctokitFactory } from './github-octokit.factory.types';
import type { OpenOrUpdatePullRequestArgs } from './merge-provider.interface';
import type { PullRequestTrackingRepository } from './pull-request-tracking.repository';
import type { PullRequestTracking } from './pull-request-tracking.entity';

const TOKEN = 'ghp_secret';
const REF_SECRET_ID = 'sec-from-row';
const STATUS_REF = {
  provider: 'github' as const,
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  url: 'https://github.com/acme/widgets/pull/7',
};
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: 'scope-1',
  contextId: 'ctx-1',
  workflowRunId: 'run-1',
  repositoryUrl: 'https://github.com/acme/widgets.git',
  githubSecretId: 'sec-1',
  headBranch: 'feature/x',
  baseBranch: 'main',
  title: 'Feature X',
  body: 'Implements X',
};

/** Build a fully-mocked octokit with overridable endpoint stubs. */
function buildOctokitMock() {
  const pulls = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    listReviews: vi.fn(),
    merge: vi.fn(),
  };
  const checks = { listForRef: vi.fn() };
  const graphql = vi.fn();
  // Shape mirrors the subset of @octokit/rest the provider touches.
  const octokit = {
    rest: { pulls, checks },
    graphql,
  } as unknown as ReturnType<OctokitFactory>;
  return { octokit, pulls, checks, graphql };
}

function buildProvider(
  octokit: ReturnType<OctokitFactory>,
  options: { trackingRow?: Partial<PullRequestTracking> | null } = {},
) {
  const credentialResolver = {
    resolveToken: vi.fn(async () => TOKEN),
  } as unknown as GitHubCredentialResolver;
  const octokitFactory = vi.fn(() => octokit) as unknown as OctokitFactory;
  const findByProviderIdentity = vi.fn(async () =>
    options.trackingRow === undefined
      ? ({ github_secret_id: REF_SECRET_ID } as PullRequestTracking)
      : (options.trackingRow as PullRequestTracking | null),
  );
  const trackingRepo = {
    findByProviderIdentity,
  } as unknown as PullRequestTrackingRepository;
  const provider = new GitHubMergeProvider(
    credentialResolver,
    octokitFactory,
    trackingRepo,
  );
  return {
    provider,
    credentialResolver,
    octokitFactory,
    findByProviderIdentity,
  };
}

describe('GitHubMergeProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "github"', () => {
    const { octokit } = buildOctokitMock();
    const { provider } = buildProvider(octokit);
    expect(provider.providerKey).toBe('github');
  });

  it('creates a PR when no open PR exists for the head branch', async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockResolvedValue({ data: [] });
    pulls.create.mockResolvedValue({
      data: { number: 42, html_url: 'https://github.com/acme/widgets/pull/42' },
    });
    const { provider, octokitFactory } = buildProvider(octokit);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(octokitFactory).toHaveBeenCalledWith(TOKEN);
    expect(pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'widgets',
        head: 'feature/x',
        base: 'main',
        title: 'Feature X',
      }),
    );
    expect(ref).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
    });
  });

  it('is idempotent: a second call updates the existing PR rather than creating a duplicate', async () => {
    const { octokit, pulls } = buildOctokitMock();
    // Existing open PR for head=acme:feature/x base=main.
    pulls.list.mockResolvedValue({
      data: [{ number: 7, html_url: 'https://github.com/acme/widgets/pull/7' }],
    });
    pulls.update.mockResolvedValue({
      data: { number: 7, html_url: 'https://github.com/acme/widgets/pull/7' },
    });
    const { provider } = buildProvider(octokit);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(pulls.create).not.toHaveBeenCalled();
    expect(pulls.update).toHaveBeenCalledTimes(2);
    expect(pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'widgets',
        pull_number: 7,
      }),
    );
    expect(first).toEqual(second);
    expect(second.number).toBe(7);
  });

  it('searches existing PRs scoped to head=owner:branch and base', async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockResolvedValue({ data: [] });
    pulls.create.mockResolvedValue({
      data: { number: 1, html_url: 'https://github.com/acme/widgets/pull/1' },
    });
    const { provider } = buildProvider(octokit);

    await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(pulls.list).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'widgets',
        state: 'open',
        head: 'acme:feature/x',
        base: 'main',
      }),
    );
  });

  it('maps PR + checks + reviews into PullRequestStatus', async () => {
    const { octokit, pulls, checks } = buildOctokitMock();
    pulls.get.mockResolvedValue({
      data: {
        state: 'open',
        merged: false,
        mergeable: true,
        merge_commit_sha: null,
        head: { sha: 'abc123' },
      },
    });
    checks.listForRef.mockResolvedValue({
      data: {
        check_runs: [{ status: 'completed', conclusion: 'success' }],
      },
    });
    pulls.listReviews.mockResolvedValue({
      data: [{ state: 'APPROVED' }],
    });
    const { provider } = buildProvider(octokit);

    const status = await provider.getPullRequestStatus({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
    });

    expect(status.state).toBe('open');
    expect(status.checks).toBe('passing');
    expect(status.reviewDecision).toBe('approved');
    expect(status.mergeable).toBe(true);
    expect(status.mergeCommitSha).toBeNull();
    expect(checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'abc123' }),
    );
  });

  it('reports the merge commit sha when a PR is merged', async () => {
    const { octokit, pulls, checks } = buildOctokitMock();
    pulls.get.mockResolvedValue({
      data: {
        state: 'closed',
        merged: true,
        mergeable: null,
        merge_commit_sha: 'deadbeef',
        head: { sha: 'abc123' },
      },
    });
    checks.listForRef.mockResolvedValue({ data: { check_runs: [] } });
    pulls.listReviews.mockResolvedValue({ data: [] });
    const { provider } = buildProvider(octokit);

    const status = await provider.getPullRequestStatus({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
    });

    expect(status.state).toBe('merged');
    expect(status.mergeCommitSha).toBe('deadbeef');
  });

  it('merges a PR with the requested merge method', async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.merge.mockResolvedValue({ data: { sha: 'mergedsha' } });
    const { provider } = buildProvider(octokit);

    const result = await provider.mergePullRequest(
      {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        number: 7,
        url: 'https://github.com/acme/widgets/pull/7',
      },
      'squash',
    );

    expect(pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'widgets',
        pull_number: 7,
        merge_method: 'squash',
      }),
    );
    expect(result).toEqual({ mergeCommitSha: 'mergedsha' });
  });

  it('getPullRequestStatus resolves the token from the tracking row github_secret_id', async () => {
    const { octokit, pulls, checks } = buildOctokitMock();
    pulls.get.mockResolvedValue({
      data: {
        state: 'open',
        merged: false,
        mergeable: true,
        merge_commit_sha: null,
        head: { sha: 'abc123' },
      },
    });
    checks.listForRef.mockResolvedValue({ data: { check_runs: [] } });
    pulls.listReviews.mockResolvedValue({ data: [] });
    const {
      provider,
      credentialResolver,
      octokitFactory,
      findByProviderIdentity,
    } = buildProvider(octokit);

    await provider.getPullRequestStatus(STATUS_REF);

    expect(findByProviderIdentity).toHaveBeenCalledWith(
      'github',
      'acme',
      'widgets',
      7,
    );
    expect(credentialResolver.resolveToken).toHaveBeenCalledWith(REF_SECRET_ID);
    expect(octokitFactory).toHaveBeenCalledWith(TOKEN);
  });

  it('getPullRequestStatus fails fast with a clear error when no tracking row exists', async () => {
    const { octokit, pulls } = buildOctokitMock();
    const { provider, credentialResolver } = buildProvider(octokit, {
      trackingRow: null,
    });

    await expect(provider.getPullRequestStatus(STATUS_REF)).rejects.toThrow(
      /no pull_request_tracking row/i,
    );
    expect(credentialResolver.resolveToken).not.toHaveBeenCalled();
    expect(pulls.get).not.toHaveBeenCalled();
  });

  it('mergePullRequest resolves the token from the tracking row github_secret_id', async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.merge.mockResolvedValue({ data: { sha: 'mergedsha' } });
    const { provider, credentialResolver, findByProviderIdentity } =
      buildProvider(octokit);

    await provider.mergePullRequest(STATUS_REF, 'squash');

    expect(findByProviderIdentity).toHaveBeenCalledWith(
      'github',
      'acme',
      'widgets',
      7,
    );
    expect(credentialResolver.resolveToken).toHaveBeenCalledWith(REF_SECRET_ID);
  });

  it('mergePullRequest fails fast with a clear error when no tracking row exists', async () => {
    const { octokit, pulls } = buildOctokitMock();
    const { provider, credentialResolver } = buildProvider(octokit, {
      trackingRow: null,
    });

    await expect(
      provider.mergePullRequest(STATUS_REF, 'squash'),
    ).rejects.toThrow(/no pull_request_tracking row/i);
    expect(credentialResolver.resolveToken).not.toHaveBeenCalled();
    expect(pulls.merge).not.toHaveBeenCalled();
  });

  it('enableAutoMerge enables merge-when-green with the mapped method', async () => {
    const { octokit, graphql } = buildOctokitMock();
    graphql
      .mockResolvedValueOnce({
        repository: { pullRequest: { id: 'PR_node_42' } },
      })
      .mockResolvedValueOnce({
        enablePullRequestAutoMerge: { pullRequest: { id: 'PR_node_42' } },
      });
    const { provider } = buildProvider(octokit);

    await provider.enableAutoMerge(
      {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        url: 'https://github.com/acme/widgets/pull/42',
      },
      'squash',
    );

    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('enablePullRequestAutoMerge'),
      expect.objectContaining({
        pullRequestId: 'PR_node_42',
        mergeMethod: 'SQUASH',
      }),
    );
  });

  it('never includes the token in an error when octokit fails', async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockRejectedValue(new Error('GitHub 403 boom'));
    const { provider } = buildProvider(octokit);

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
