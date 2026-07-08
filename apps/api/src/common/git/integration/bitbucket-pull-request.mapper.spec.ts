import { describe, it, expect } from 'vitest';
import {
  mapBitbucketChecks,
  mapBitbucketMergeStrategy,
  mapBitbucketReviewDecision,
  mapBitbucketState,
} from './bitbucket-pull-request.mapper';

describe('mapBitbucketState', () => {
  it('maps MERGED to "merged"', () => {
    expect(mapBitbucketState({ state: 'MERGED' })).toBe('merged');
  });
  it('maps OPEN to "open"', () => {
    expect(mapBitbucketState({ state: 'OPEN' })).toBe('open');
  });
  it('maps DECLINED to "closed"', () => {
    expect(mapBitbucketState({ state: 'DECLINED' })).toBe('closed');
  });
});

describe('mapBitbucketChecks', () => {
  it('returns "unknown" with no statuses', () => {
    expect(mapBitbucketChecks([])).toBe('unknown');
  });
  it('returns "passing" when all statuses succeeded', () => {
    expect(mapBitbucketChecks([{ state: 'SUCCESSFUL' }])).toBe('passing');
  });
  it('returns "failing" when any status failed', () => {
    expect(
      mapBitbucketChecks([{ state: 'SUCCESSFUL' }, { state: 'FAILED' }]),
    ).toBe('failing');
  });
  it('returns "pending" when any status is in progress', () => {
    expect(mapBitbucketChecks([{ state: 'INPROGRESS' }])).toBe('pending');
  });
});

describe('mapBitbucketReviewDecision', () => {
  it('returns "approved" when a reviewer approved', () => {
    expect(
      mapBitbucketReviewDecision([{ role: 'REVIEWER', approved: true }]),
    ).toBe('approved');
  });
  it('returns "review_required" when reviewers exist but none approved', () => {
    expect(
      mapBitbucketReviewDecision([{ role: 'REVIEWER', approved: false }]),
    ).toBe('review_required');
  });
  it('returns "none" when there are no reviewers', () => {
    expect(
      mapBitbucketReviewDecision([{ role: 'PARTICIPANT', approved: false }]),
    ).toBe('none');
  });
});

describe('mapBitbucketMergeStrategy', () => {
  it('maps "merge" to merge_commit', () => {
    expect(mapBitbucketMergeStrategy('merge')).toBe('merge_commit');
  });
  it('maps "squash" to squash', () => {
    expect(mapBitbucketMergeStrategy('squash')).toBe('squash');
  });
  it('maps "rebase" to fast_forward', () => {
    expect(mapBitbucketMergeStrategy('rebase')).toBe('fast_forward');
  });
});
