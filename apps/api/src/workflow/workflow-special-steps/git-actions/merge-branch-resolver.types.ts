/** Branch + worktree identity resolved for a merge-family git action. */
export interface ResolvedMergeBranches {
  baseBranch: string;
  targetBranch: string;
  worktreeId: string;
  worktreePath: string;
}
