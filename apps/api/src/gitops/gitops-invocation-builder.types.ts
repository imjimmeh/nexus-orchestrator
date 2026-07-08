/**
 * Public types for `GitOpsInvocationBuilder`.
 *
 * Kept in a dedicated `*.types.ts` file per the project's
 * `no-restricted-syntax` ESLint rule (exported type aliases
 * belong here, not in the implementation file).
 */
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

/**
 * Input contract for `GitOpsInvocationBuilder.build`. The
 * caller provides the binding whose credentials should be
 * resolved, the exact git subcommand + argument list to
 * execute, and the working directory git should be invoked
 * in. The builder does not own the command itself — it only
 * augments it with credential-derived env entries (and, for
 * SSH, a per-invocation temp key file).
 */
export interface BuildInvocationInput {
  binding: GitOpsRepositoryBinding;
  args: string[];
  cwd: string;
}

/**
 * The credential-augmented plan returned by the builder.
 *
 * - `args` is the exact argument list to forward to
 *   `git -C <cwd>`.
 * - `cwd` is the git working directory (forwarded to
 *   `GitCommandService.exec`).
 * - `env` is the env dict to merge over `process.env` for
 *   the single git invocation. It contains credential-related
 *   entries only — never unrelated process env.
 * - `cleanup` is an idempotent async hook the caller MUST
 *   await in a `finally` block. It is responsible for
 *   unlinking any per-invocation temp file the builder
 *   created (currently only the SSH private-key temp file).
 */
export interface GitInvocation {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}
