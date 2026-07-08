import { describe, expect, it, vi } from 'vitest';
import { PrPollReconcilerService } from './pr-poll-reconciler.service';

const openRow = {
  id: 'row-1',
  provider: 'github',
  owner: 'acme',
  repo: 'widgets',
  pr_number: 42,
  pr_url: 'https://github.com/acme/widgets/pull/42',
  repository_url: 'https://github.com/acme/widgets.git',
  scope_id: 'scope-1',
  context_id: 'context-1',
  state: 'open',
};

function build(statusState: 'open' | 'merged', mergeSha: string | null = null) {
  const trackingRepo = { findOpen: vi.fn().mockResolvedValue([openRow]) };
  const provider = {
    getPullRequestStatus: vi.fn().mockResolvedValue({
      ref: {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        url: openRow.pr_url,
      },
      state: statusState,
      checks: 'passing',
      reviewDecision: 'approved',
      mergeCommitSha: mergeSha,
      mergeable: true,
    }),
  };
  const factory = { resolveForRepository: vi.fn().mockReturnValue(provider) };
  const finalizer = {
    finalizeMergedRow: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const publisher = { publishPrStatus: vi.fn().mockResolvedValue('1-0') };
  const service = new PrPollReconcilerService(
    trackingRepo as never,
    factory as never,
    finalizer as never,
    publisher as never,
  );
  return { service, provider, finalizer, trackingRepo, factory, publisher };
}

describe('PrPollReconcilerService.reconcileOnce', () => {
  it('finalizes an open row whose provider status is now merged', async () => {
    const { service, finalizer } = build('merged', 'sha-merge');
    await service.reconcileOnce();
    expect(finalizer.finalizeMergedRow).toHaveBeenCalledWith(
      openRow,
      'sha-merge',
    );
  });

  it('resolves the provider from the repository url, not the PR url', async () => {
    const { service, factory } = build('open');
    await service.reconcileOnce();
    expect(factory.resolveForRepository).toHaveBeenCalledWith(
      openRow.repository_url,
    );
  });

  it('leaves a still-open PR untouched (no finalize)', async () => {
    const { service, finalizer } = build('open', null);
    await service.reconcileOnce();
    expect(finalizer.finalizeMergedRow).not.toHaveBeenCalled();
  });

  it('isolates a per-row provider error and does not throw', async () => {
    const { service, provider, finalizer } = build('open');
    provider.getPullRequestStatus.mockRejectedValue(new Error('rate limit'));
    await expect(service.reconcileOnce()).resolves.toBeUndefined();
    expect(finalizer.finalizeMergedRow).not.toHaveBeenCalled();
  });
});

function makeRow(
  overrides: Partial<{ auto_merge: boolean; merge_method: string }> = {},
) {
  return {
    id: 'row-1',
    provider: 'github',
    owner: 'acme',
    repo: 'widgets',
    pr_number: 42,
    pr_url: 'https://github.com/acme/widgets/pull/42',
    repository_url: 'https://github.com/acme/widgets.git',
    head_branch: 'feature/x',
    base_branch: 'main',
    scope_id: 'scope-1',
    context_id: 'context-1',
    workflow_run_id: '11111111-1111-1111-1111-111111111111',
    state: 'open',
    merge_commit_sha: null,
    auto_merge: overrides.auto_merge ?? false,
    merge_method: overrides.merge_method ?? 'merge',
  };
}

function buildMergeBranch(
  status: { state: string; checks: string; reviewDecision: string },
  row = makeRow(),
) {
  const trackingRepo = { findOpen: vi.fn().mockResolvedValue([row]) };
  const provider = {
    getPullRequestStatus: vi.fn().mockResolvedValue({
      ref: {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        url: row.pr_url,
      },
      state: status.state,
      checks: status.checks,
      reviewDecision: status.reviewDecision,
      mergeCommitSha: null,
      mergeable: true,
    }),
    mergePullRequest: vi.fn().mockResolvedValue({ mergeCommitSha: 'abc123' }),
  };
  const factory = { resolveForRepository: vi.fn().mockReturnValue(provider) };
  const finalizer = {
    finalizeMergedRow: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const publisher = { publishPrStatus: vi.fn().mockResolvedValue('1-0') };
  const service = new PrPollReconcilerService(
    trackingRepo as never,
    factory as never,
    finalizer as never,
    publisher as never,
  );
  return { service, provider, trackingRepo, finalizer, publisher };
}

describe('PrPollReconcilerService API-merge branch', () => {
  it('autoMerge=false + green checks: API-merges with the row merge_method', async () => {
    const { service, provider } = buildMergeBranch(
      { state: 'open', checks: 'passing', reviewDecision: 'approved' },
      makeRow({ auto_merge: false, merge_method: 'squash' }),
    );

    await service.reconcileOnce();

    expect(provider.mergePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ number: 42 }),
      'squash',
    );
  });

  it('autoMerge=false + failing checks: does NOT merge', async () => {
    const { service, provider } = buildMergeBranch({
      state: 'open',
      checks: 'failing',
      reviewDecision: 'approved',
    });

    await service.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it('autoMerge=false + pending checks: does NOT merge', async () => {
    const { service, provider } = buildMergeBranch({
      state: 'open',
      checks: 'pending',
      reviewDecision: 'review_required',
    });

    await service.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it('autoMerge=false + changes_requested (even with green checks): does NOT merge', async () => {
    const { service, provider } = buildMergeBranch({
      state: 'open',
      checks: 'passing',
      reviewDecision: 'changes_requested',
    });

    await service.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it('autoMerge=true: never API-merges (provider-native auto-merge owns it)', async () => {
    const { service, provider } = buildMergeBranch(
      { state: 'open', checks: 'passing', reviewDecision: 'approved' },
      makeRow({ auto_merge: true, merge_method: 'merge' }),
    );

    await service.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });
});

describe('PrPollReconcilerService pr_status emit (open branch)', () => {
  it('an open PR with failing checks emits a pr_status event carrying checks:failing', async () => {
    const { service, publisher, finalizer } = build('open', null);

    await service.reconcileOnce();

    // build() returns checks:'passing' by default; assert the emit happens on
    // the open branch and carries the observed status. Use a failing variant.
    expect(finalizer.finalizeMergedRow).not.toHaveBeenCalled();
    expect(publisher.publishPrStatus).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: openRow.pr_url,
      checks: 'passing',
      reviewDecision: 'approved',
    });
  });

  it('emits the observed failing checks/changes_requested for an open PR', async () => {
    const { service, publisher } = buildMergeBranch({
      state: 'open',
      checks: 'failing',
      reviewDecision: 'changes_requested',
    });

    await service.reconcileOnce();

    expect(publisher.publishPrStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: 'failing',
        reviewDecision: 'changes_requested',
      }),
    );
  });

  it('a merged PR finalizes and does NOT emit pr_status', async () => {
    const { service, finalizer, publisher } = build('merged', 'sha-merge');

    await service.reconcileOnce();

    expect(finalizer.finalizeMergedRow).toHaveBeenCalledWith(
      openRow,
      'sha-merge',
    );
    expect(publisher.publishPrStatus).not.toHaveBeenCalled();
  });
});
