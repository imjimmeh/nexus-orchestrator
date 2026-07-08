import type {
  MergeMethod,
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from './merge-provider.interface';

const FAILING_BUILD = new Set(['FAILED', 'STOPPED']);
const PENDING_BUILD = new Set(['INPROGRESS']);

export function mapBitbucketState(pr: { state: string }): PullRequestState {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  return pr.state === 'OPEN' ? 'open' : 'closed';
}

export function mapBitbucketChecks(
  statuses: { state: string }[],
): PullRequestChecksStatus {
  if (statuses.length === 0) {
    return 'unknown';
  }
  if (statuses.some((s) => FAILING_BUILD.has(s.state))) {
    return 'failing';
  }
  if (statuses.some((s) => PENDING_BUILD.has(s.state))) {
    return 'pending';
  }
  if (statuses.every((s) => s.state === 'SUCCESSFUL')) {
    return 'passing';
  }
  return 'unknown';
}

export function mapBitbucketReviewDecision(
  participants: { role: string; approved: boolean }[],
): PullRequestStatus['reviewDecision'] {
  const reviewers = participants.filter((p) => p.role === 'REVIEWER');
  if (reviewers.some((r) => r.approved)) {
    return 'approved';
  }
  if (reviewers.length > 0) {
    return 'review_required';
  }
  return 'none';
}

export function mapBitbucketMergeStrategy(
  method: MergeMethod,
): 'merge_commit' | 'squash' | 'fast_forward' {
  switch (method) {
    case 'squash':
      return 'squash';
    case 'rebase':
      return 'fast_forward';
    case 'merge':
    default:
      return 'merge_commit';
  }
}
