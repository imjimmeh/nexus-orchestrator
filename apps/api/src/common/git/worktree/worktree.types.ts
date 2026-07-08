const ZERO_HASH = '0'.repeat(40);

export interface GitWorktreeEntry {
  path: string;
  branch?: string;
  /** Commit hash reported by `git worktree list --porcelain`. */
  head?: string;
  /**
   * Present when the worktree is locked. The value is the lock reason text, or
   * an empty string when locked with no reason.
   */
  locked?: string;
}

/**
 * Returns true when a worktree entry represents a fully-initialized worktree.
 * A worktree is considered stale/uninitialized when git reports its HEAD as
 * all zeros (occurs when `git worktree add` was interrupted mid-checkout).
 * Entries without a `head` field are treated as initialized for compatibility.
 */
export function isWorktreeInitialized(entry: GitWorktreeEntry): boolean {
  if (entry.head === undefined) {
    return true;
  }
  return entry.head !== ZERO_HASH;
}
