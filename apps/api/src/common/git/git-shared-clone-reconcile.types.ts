export interface PorcelainEntry {
  status: string;
  path: string;
}

export interface SharedCloneBlockerClassification {
  restorable: string[];
  quarantinable: string[];
  ambiguous: string[];
}

/** Git/filesystem seam the deterministic reconcile executor operates through. */
export interface SharedCloneReconcileRunner {
  runGit(
    repoPath: string,
    args: string[],
    authEnv: Record<string, string>,
  ): Promise<void>;
  runGitCapture(
    repoPath: string,
    args: string[],
    authEnv: Record<string, string>,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  moveFileWithDirs(from: string, to: string): Promise<void>;
}
