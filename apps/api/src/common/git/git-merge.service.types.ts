export type MergeOutcome =
  | 'succeeded'
  | 'conflict'
  | 'auth_error'
  | 'quality_gate_failed'
  | 'shared_clone_dirty'
  | 'failed';

export type AuthErrorClass = 'credentials' | 'network' | 'permission';

/** Exit code and captured streams from a non-throwing git invocation. */
export interface GitCaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MergeResult {
  outcome: MergeOutcome;
  sourceBranch: string;
  destinationBranch: string;
  conflictedFiles: string[];
  message: string;
  authErrorClass?: AuthErrorClass;
  /** Combined stdout+stderr from a push rejected by the pre-push quality gate. */
  qualityGateLog?: string;
  /** Commit SHA of the destination branch immediately before the merge. */
  baseMergeCommit?: string;
  /** Commit SHA created by the merge (the --no-ff merge commit). */
  mergeCommit?: string;
  /** Shared clone paths that must be reconciled before direct integration. */
  dirtyPaths?: string[];
  /** Absolute path of the shared clone root the merge/preflight operated on. */
  sharedClonePath?: string;
  /** Tracked deletions restored from HEAD by deterministic reconciliation. */
  restoredPaths?: string[];
  /** Blocking untracked files moved into the quarantine directory. */
  quarantinedPaths?: string[];
}
