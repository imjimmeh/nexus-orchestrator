import { describe, expect, it } from 'vitest';
import { isPullRequestMergeable } from './merge-provider.helpers';
import type { PullRequestStatus } from './merge-provider.interface';

function status(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
  return {
    ref: {
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
    },
    state: 'open',
    checks: 'passing',
    reviewDecision: 'approved',
    mergeCommitSha: null,
    mergeable: true,
    ...overrides,
  };
}

describe('isPullRequestMergeable', () => {
  it('is true for an open PR with passing checks and no changes requested', () => {
    expect(isPullRequestMergeable(status())).toBe(true);
  });

  it('is true when review is required but checks pass (branch protection decides)', () => {
    expect(
      isPullRequestMergeable(status({ reviewDecision: 'review_required' })),
    ).toBe(true);
  });

  it('is false when checks are failing', () => {
    expect(isPullRequestMergeable(status({ checks: 'failing' }))).toBe(false);
  });

  it('is false when checks are pending', () => {
    expect(isPullRequestMergeable(status({ checks: 'pending' }))).toBe(false);
  });

  it('is false when checks are unknown', () => {
    expect(isPullRequestMergeable(status({ checks: 'unknown' }))).toBe(false);
  });

  it('is false when changes were requested even with passing checks', () => {
    expect(
      isPullRequestMergeable(status({ reviewDecision: 'changes_requested' })),
    ).toBe(false);
  });

  it('is false when the PR is no longer open', () => {
    expect(isPullRequestMergeable(status({ state: 'merged' }))).toBe(false);
    expect(isPullRequestMergeable(status({ state: 'closed' }))).toBe(false);
  });
});
