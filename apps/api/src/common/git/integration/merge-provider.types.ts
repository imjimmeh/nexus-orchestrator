export type IntegrationStrategy = 'direct-push' | 'pull-request';
export type MergeMethod = 'merge' | 'squash' | 'rebase';
export type PullRequestState = 'open' | 'merged' | 'closed';
export type PullRequestChecksStatus =
  | 'pending'
  | 'passing'
  | 'failing'
  | 'unknown';

export interface OpenOrUpdatePullRequestArgs {
  scopeId: string; // neutral project/scope id
  contextId: string; // neutral context id
  workflowRunId: string;
  repositoryUrl: string; // e.g. https://github.com/owner/repo(.git)
  githubSecretId: string;
  headBranch: string; // feature branch (already pushed)
  baseBranch: string; // target/base branch
  title: string;
  body: string;
}

export interface PullRequestRef {
  provider: string; // 'github' | 'gitlab' | 'bitbucket'
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface PullRequestStatus {
  ref: PullRequestRef;
  state: PullRequestState;
  checks: PullRequestChecksStatus;
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | 'none';
  mergeCommitSha: string | null; // populated when state === 'merged'
  mergeable: boolean | null;
}

export interface MergeProvider {
  readonly providerKey: string; // 'github'
  openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef>;
  getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus>;
  mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }>;
  /**
   * Enable provider-native "merge when green" so the engine does NOT API-merge.
   * Optional: a provider without auto-merge support omits it; callers must guard
   * on presence and fall back to reconciler-driven API-merge.
   */
  enableAutoMerge?(ref: PullRequestRef, method: MergeMethod): Promise<void>;
}
