import { WorkflowStatus } from '@nexus/core';
import type { RunStatusTimestampSnapshot } from './workflow-run-status-timestamps.types';

export type { RunStatusTimestampSnapshot } from './workflow-run-status-timestamps.types';

const TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.CANCELLED,
]);

/**
 * Computes the timestamp patch for a run status transition. Returns only the
 * fields that should change; never overwrites a timestamp that is already set.
 */
export function buildRunStatusTimestampPatch(
  current: RunStatusTimestampSnapshot,
  nextStatus: WorkflowStatus,
  now: Date,
): { started_at?: Date; completed_at?: Date } {
  const patch: { started_at?: Date; completed_at?: Date } = {};

  if (nextStatus === WorkflowStatus.RUNNING && !current.started_at) {
    patch.started_at = now;
  }

  if (TERMINAL_STATUSES.has(nextStatus) && !current.completed_at) {
    patch.completed_at = now;
  }

  return patch;
}
