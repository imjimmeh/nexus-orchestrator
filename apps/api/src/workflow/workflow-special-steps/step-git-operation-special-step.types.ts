export type GitOperationAction =
  | 'merge'
  | 'merge_prepare'
  | 'merge_integrate'
  | 'merge_integrate_preflight'
  | 'merge_integrate_reconcile'
  | 'provision_worktree'
  | 'remove_worktree'
  | 'create_branch'
  | 'commit_paths';

export interface TriggerContext {
  repositoryId: string;
  worktreeId?: string;
  branchConfig?: {
    baseBranch?: string;
    targetBranch?: string;
  };
}
