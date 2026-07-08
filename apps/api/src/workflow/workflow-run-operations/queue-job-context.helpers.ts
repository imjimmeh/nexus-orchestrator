/**
 * Pure helpers for inspecting BullMQ job payloads emitted by the workflow
 * step queue. Extracted from `WorkflowRunReconciliationService` so the
 * reconciliation service stays under the project's 500-line cap while the
 * helpers stay unit-testable in isolation.
 */
import type { QueueJobContext } from './queue-job-context.types';

/**
 * Read the workflow-run / job id pair out of a BullMQ job's data payload.
 * Returns `null` for shapes we do not recognise (e.g. unrelated queue
 * producers) so reconciliation can skip them without throwing.
 */
export function extractQueueJobContext(data: unknown): QueueJobContext | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.workflowRunId !== 'string') {
    return null;
  }

  return {
    workflowRunId: record.workflowRunId,
    jobId: typeof record.jobId === 'string' ? record.jobId : undefined,
  };
}

/**
 * Resolve the job id to use as a fallback when a queue payload omits
 * `jobId`. Falls back to the literal `unknown_job` so dedupe keys remain
 * stable across runs that have not advanced past `current_step_id`.
 */
export function resolveRunJobId(currentStepId: string | undefined): string {
  return currentStepId && currentStepId.length > 0
    ? currentStepId
    : 'unknown_job';
}

/**
 * Build the dedupe key used to suppress repeated handling of the same
 * failed BullMQ job within the reconciliation cycle's TTL.
 */
export function computeFailedJobKey(
  failedJob: { id?: string },
  workflowRunId: string,
  jobId: string,
  failedReason: string,
): string {
  if (failedJob.id) {
    return failedJob.id;
  }
  return `${workflowRunId}:${jobId}:${failedReason}`;
}
