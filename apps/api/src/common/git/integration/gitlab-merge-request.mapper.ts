import type {
  MergeMethod,
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from './merge-provider.interface';

const PENDING_PIPELINE = new Set([
  'running',
  'pending',
  'created',
  'waiting_for_resource',
  'preparing',
  'scheduled',
]);
const FAILING_PIPELINE = new Set(['failed', 'canceled']);

export function mapGitlabState(mr: { state: string }): PullRequestState {
  if (mr.state === 'merged') {
    return 'merged';
  }
  return mr.state === 'opened' ? 'open' : 'closed';
}

export function mapGitlabChecks(
  pipeline: { status: string } | null,
): PullRequestChecksStatus {
  if (!pipeline) {
    return 'unknown';
  }
  if (pipeline.status === 'success') {
    return 'passing';
  }
  if (FAILING_PIPELINE.has(pipeline.status)) {
    return 'failing';
  }
  if (PENDING_PIPELINE.has(pipeline.status)) {
    return 'pending';
  }
  return 'unknown';
}

export function mapGitlabReviewDecision(approvals: {
  approved: boolean;
  approvals_required: number;
  approvals_left: number;
}): PullRequestStatus['reviewDecision'] {
  if (
    approvals.approved ||
    (approvals.approvals_required > 0 && approvals.approvals_left === 0)
  ) {
    return 'approved';
  }
  if (approvals.approvals_required > 0) {
    return 'review_required';
  }
  return 'none';
}

export function mapGitlabMergeMethod(method: MergeMethod): { squash: boolean } {
  return { squash: method === 'squash' };
}
