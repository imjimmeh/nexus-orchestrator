import { describe, it, expect } from 'vitest';
import {
  mapGitlabChecks,
  mapGitlabMergeMethod,
  mapGitlabReviewDecision,
  mapGitlabState,
} from './gitlab-merge-request.mapper';

describe('mapGitlabState', () => {
  it('maps a merged MR to "merged"', () => {
    expect(mapGitlabState({ state: 'merged' })).toBe('merged');
  });
  it('maps an opened MR to "open"', () => {
    expect(mapGitlabState({ state: 'opened' })).toBe('open');
  });
  it('maps a closed MR to "closed"', () => {
    expect(mapGitlabState({ state: 'closed' })).toBe('closed');
  });
});

describe('mapGitlabChecks', () => {
  it('returns "unknown" with no pipeline', () => {
    expect(mapGitlabChecks(null)).toBe('unknown');
  });
  it('returns "passing" for a successful pipeline', () => {
    expect(mapGitlabChecks({ status: 'success' })).toBe('passing');
  });
  it('returns "failing" for a failed pipeline', () => {
    expect(mapGitlabChecks({ status: 'failed' })).toBe('failing');
  });
  it('returns "pending" for a running pipeline', () => {
    expect(mapGitlabChecks({ status: 'running' })).toBe('pending');
  });
});

describe('mapGitlabReviewDecision', () => {
  it('returns "approved" when fully approved', () => {
    expect(
      mapGitlabReviewDecision({
        approved: true,
        approvals_required: 1,
        approvals_left: 0,
      }),
    ).toBe('approved');
  });
  it('returns "review_required" when approvals remain', () => {
    expect(
      mapGitlabReviewDecision({
        approved: false,
        approvals_required: 2,
        approvals_left: 1,
      }),
    ).toBe('review_required');
  });
  it('returns "none" when no approvals are required and none given', () => {
    expect(
      mapGitlabReviewDecision({
        approved: false,
        approvals_required: 0,
        approvals_left: 0,
      }),
    ).toBe('none');
  });
});

describe('mapGitlabMergeMethod', () => {
  it('maps "squash" to squash=true', () => {
    expect(mapGitlabMergeMethod('squash')).toEqual({ squash: true });
  });
  it('maps "merge" to squash=false', () => {
    expect(mapGitlabMergeMethod('merge')).toEqual({ squash: false });
  });
  it('maps "rebase" to squash=false (gitlab has no rebase-merge)', () => {
    expect(mapGitlabMergeMethod('rebase')).toEqual({ squash: false });
  });
});
