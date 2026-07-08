/**
 * Shell execution seam used by the run_command special-step handler.
 * Injectable so timeout resolution and failure handling can be unit-tested
 * without spawning real processes.
 */
export type RunCommandExec = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Default `timeout_ms` applied when a `run_command` step does not specify one.
 */
export const RUN_COMMAND_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Hard ceiling applied to a `run_command` step's `timeout_ms`.
 *
 * Must comfortably exceed the longest legitimate run_command workload —
 * notably the auto-merge quality gate (build + lint + full test suites),
 * which runs for several minutes. A lower cap silently kills the gate
 * mid-run and makes the merge workflow structurally unwinnable.
 *
 * Lives in the `.types.ts` module so callers (validators, tests) can import
 * it without reaching into the handler implementation file.
 */
export const RUN_COMMAND_MAX_TIMEOUT_MS = 1_800_000;
