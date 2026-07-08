/**
 * Heartbeat cadence for an in-flight `run_command` step. Must stay comfortably
 * below the stale-run watchdog grace window (`WORKFLOW_STALE_RUN_GRACE_MS`,
 * default 5 min) so a long command (e.g. the merge quality gate's full test
 * suite, ~6.5 min) keeps its execution record alive while it runs, rather than
 * being reaped as a stalled run.
 */
export const COMMAND_STEP_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Runs `operation` while emitting a periodic liveness heartbeat. The open
 * synchronous request to the container is itself proof the step is alive, so we
 * tick `onHeartbeat` on a fixed interval independent of streamed log output
 * (command output is typically buffered until completion and would otherwise
 * starve the heartbeat). The timer is always cleared when the operation
 * settles, whether it resolves or rejects.
 */
export async function runWithPeriodicHeartbeat<T>(
  operation: () => Promise<T>,
  onHeartbeat: () => void,
  options?: { intervalMs?: number },
): Promise<T> {
  const intervalMs = options?.intervalMs ?? COMMAND_STEP_HEARTBEAT_INTERVAL_MS;
  const timer = setInterval(() => {
    onHeartbeat();
  }, intervalMs);
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}
