/**
 * Outcome of {@link BranchOperationsService.syncDefaultBranchToOrigin}.
 *
 * - `no-remote`      — the clone has no `origin` remote; nothing to sync.
 * - `already-current` — the local default branch already matches origin.
 * - `fast-forwarded` — the local default branch was advanced to origin.
 * - `diverged`       — the local default branch is ahead of / diverged from
 *                      origin and was deliberately left untouched.
 * - `skipped`        — the default branch could not be resolved or the
 *                      fast-forward was unsafe (e.g. a dirty working tree).
 */
export interface DefaultBranchSyncResult {
  status:
    | 'no-remote'
    | 'already-current'
    | 'fast-forwarded'
    | 'diverged'
    | 'skipped';
  branch: string | null;
}
