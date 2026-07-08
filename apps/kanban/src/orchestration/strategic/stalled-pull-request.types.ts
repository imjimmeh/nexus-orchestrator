export type StalledPullRequestReason =
  | "red_checks"
  | "changes_requested"
  | "stale_open";

export interface StalledPullRequest {
  id: string;
  title: string;
  prUrl: string;
  reason: StalledPullRequestReason;
}
