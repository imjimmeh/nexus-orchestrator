import { describe, it, expect } from 'vitest';
import {
  mapChecksStatus,
  mapPullRequestState,
  mapReviewDecision,
} from './github-pull-request.mapper';

describe('mapPullRequestState', () => {
  it('maps a merged PR to "merged"', () => {
    expect(mapPullRequestState({ state: 'closed', merged: true })).toBe(
      'merged',
    );
  });
  it('maps an open PR to "open"', () => {
    expect(mapPullRequestState({ state: 'open', merged: false })).toBe('open');
  });
  it('maps a closed-unmerged PR to "closed"', () => {
    expect(mapPullRequestState({ state: 'closed', merged: false })).toBe(
      'closed',
    );
  });
});

describe('mapChecksStatus', () => {
  it('returns "unknown" with no check runs', () => {
    expect(mapChecksStatus([])).toBe('unknown');
  });
  it('returns "pending" while any check is still running', () => {
    expect(
      mapChecksStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null },
      ]),
    ).toBe('pending');
  });
  it('returns "failing" when any completed check failed', () => {
    expect(
      mapChecksStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('failing');
  });
  it('returns "passing" when all checks completed successfully', () => {
    expect(
      mapChecksStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'neutral' },
      ]),
    ).toBe('passing');
  });
});

describe('mapReviewDecision', () => {
  it('returns "none" with no reviews', () => {
    expect(mapReviewDecision([])).toBe('none');
  });
  it('returns "changes_requested" when latest review requests changes', () => {
    expect(
      mapReviewDecision([
        { state: 'APPROVED' },
        { state: 'CHANGES_REQUESTED' },
      ]),
    ).toBe('changes_requested');
  });
  it('returns "approved" when reviews end approved', () => {
    expect(
      mapReviewDecision([
        { state: 'CHANGES_REQUESTED' },
        { state: 'APPROVED' },
      ]),
    ).toBe('approved');
  });
  it('returns "review_required" when only comments exist', () => {
    expect(mapReviewDecision([{ state: 'COMMENTED' }])).toBe('review_required');
  });
});
