export type CommitPathsStatus = "clean" | "committed";

export interface CommitPathsParams {
  repoPath: string;
  paths: string[];
  message: string;
  /** When true, push the current branch to its remote after committing. */
  push?: boolean;
}

export interface CommitPathsResult {
  committed: boolean;
  status: CommitPathsStatus;
  changed_files: string[];
  commit_sha: string | null;
}
