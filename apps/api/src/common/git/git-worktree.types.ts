export type ProvisionWorktreeWithinLockParams = {
  repoPath: string;
  worktreePath: string;
  scopeId: string;
  contextId: string;
  baseBranch: string;
  targetBranch: string;
};

export type RemoveWorktreeWithinLockParams = {
  repoPath: string;
  worktreePath: string;
  scopeId: string;
  contextId: string;
  targetBranch?: string;
};
