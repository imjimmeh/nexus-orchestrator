import type { MergeMethod, PullRequestState } from './merge-provider.interface';

export interface RecordOpenedPullRequestInput {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  scopeId: string;
  contextId: string;
  workflowRunId: string;
  headBranch: string;
  baseBranch: string;
  prUrl: string;
  githubSecretId: string;
  repositoryUrl: string;
  autoMerge: boolean;
  mergeMethod: MergeMethod;
}

export type { MergeMethod, PullRequestState };
