import type {
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from './merge-provider.interface';

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export function mapPullRequestState(pr: {
  state: string;
  merged: boolean;
}): PullRequestState {
  if (pr.merged) {
    return 'merged';
  }
  return pr.state === 'open' ? 'open' : 'closed';
}

export function mapChecksStatus(
  checkRuns: { status: string; conclusion: string | null }[],
): PullRequestChecksStatus {
  if (checkRuns.length === 0) {
    return 'unknown';
  }
  if (checkRuns.some((run) => run.status !== 'completed')) {
    return 'pending';
  }
  if (
    checkRuns.some(
      (run) =>
        run.conclusion === null || !PASSING_CONCLUSIONS.has(run.conclusion),
    )
  ) {
    return 'failing';
  }
  return 'passing';
}

export function mapReviewDecision(
  reviews: { state: string }[],
): PullRequestStatus['reviewDecision'] {
  const decisive = reviews
    .map((review) => review.state)
    .filter((state) => state === 'APPROVED' || state === 'CHANGES_REQUESTED');

  const latest = decisive.at(-1);
  if (latest === 'CHANGES_REQUESTED') {
    return 'changes_requested';
  }
  if (latest === 'APPROVED') {
    return 'approved';
  }
  return reviews.length === 0 ? 'none' : 'review_required';
}
