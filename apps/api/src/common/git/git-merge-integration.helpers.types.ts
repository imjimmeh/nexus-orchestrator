import type { LoggerService } from '@nestjs/common';

type GitAuthEnv = Record<string, string>;

/**
 * Git seams the clone-root integration stage needs. `GitMergeService` provides
 * these (and is passed as the runner) so the spec's existing `runGit` /
 * `runGitCapture` spies remain the single mocking surface.
 */
export interface GitIntegrationRunner {
  readonly logger: LoggerService;
  runGit(repoPath: string, args: string[], authEnv?: GitAuthEnv): Promise<void>;
  runGitCapture(
    repoPath: string,
    args: string[],
    authEnv?: GitAuthEnv,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  revParseHead(repoPath: string): Promise<string>;
  fetchOriginBranch(
    repoPath: string,
    branchName: string,
    authEnv: GitAuthEnv,
  ): Promise<void>;
  refExists(repoPath: string, ref: string): Promise<boolean>;
  getConflictedFiles(repoPath: string): Promise<string[]>;
  abortMergeBestEffort(repoPath: string): Promise<void>;
}
