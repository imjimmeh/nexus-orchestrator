import type { PullRequestStatus } from './merge-provider.interface';

/**
 * Pure "is this PR safe to API-merge now?" gate for the poll reconciler.
 *
 * A tracked PR is mergeable iff it is still open, its required checks are
 * observed green, and review has not requested changes. `review_required` /
 * `none` are NOT blockers here — provider branch protection is the gate of
 * record; this predicate only refuses to merge a PR the provider would also
 * refuse (red checks) or that a reviewer has explicitly rejected.
 *
 * Neutral VCS-domain logic — no downstream domain identifiers.
 */
export function isPullRequestMergeable(status: PullRequestStatus): boolean {
  return (
    status.state === 'open' &&
    status.checks === 'passing' &&
    status.reviewDecision !== 'changes_requested'
  );
}
