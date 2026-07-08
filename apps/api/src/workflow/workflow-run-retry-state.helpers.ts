import type { AutoRetryStateMutator } from './workflow-run-retry-state.helpers.types';

/** Single source of truth for the per-job auto-retry state-variable paths. */
export const autoRetryEntryPath = (jobId: string): string =>
  `_internal.auto_retry.${jobId}`;
export const autoRetryLastFailurePath = (jobId: string): string =>
  `${autoRetryEntryPath(jobId)}.last_failure`;
export const autoRetryAttemptPath = (jobId: string): string =>
  `${autoRetryEntryPath(jobId)}.attempt`;
export const autoRetryFirstFailureAtPath = (jobId: string): string =>
  `${autoRetryEntryPath(jobId)}.first_failure_at`;

/**
 * Removes the `last_failure` marker that drives the "waiting on retry" UI banner
 * while preserving the attempt/first-failure budget. Call when an auto-retry job
 * activates: the retry is no longer *pending*, so the banner must clear, but the
 * budget must survive in case this attempt also fails.
 */
export async function clearAutoRetryPendingMarker(
  stateManager: AutoRetryStateMutator,
  runId: string,
  jobId: string,
): Promise<void> {
  await stateManager.deleteVariable(runId, autoRetryLastFailurePath(jobId));
}

/**
 * Removes the entire per-job auto-retry entry (marker + budget). Call when the
 * job reaches a terminal state (completed or failed-after-retries) so no stale
 * retry state lingers to mislead the UI or skew a later loop iteration's budget.
 */
export async function clearAutoRetryState(
  stateManager: AutoRetryStateMutator,
  runId: string,
  jobId: string,
): Promise<void> {
  await stateManager.deleteVariable(runId, autoRetryEntryPath(jobId));
}
