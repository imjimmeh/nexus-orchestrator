import {
  asRecord,
  WAIT_REASON_VALUES,
  WorkflowStatus,
  type RunningWorkflowSummary,
  type WaitReason,
} from '@nexus/core';
import type {
  MapRunningWorkflowSummariesOptions,
  RunningWorkflowRunRecord,
} from './running-workflows.types';

const MILLISECONDS_PER_SECOND = 1000;
const ACTIVE_STATUSES = new Set<WorkflowStatus>([
  WorkflowStatus.PENDING,
  WorkflowStatus.RUNNING,
]);

function resolveWaitReason(value: unknown): WaitReason | undefined {
  return typeof value === 'string' &&
    (WAIT_REASON_VALUES as readonly string[]).includes(value)
    ? (value as WaitReason)
    : undefined;
}

function resolveParentRunId(
  stateVariables: Record<string, unknown>,
): string | undefined {
  const trigger = asRecord(stateVariables.trigger);
  for (const candidate of [
    trigger.parentRunId,
    trigger.parent_run_id,
    trigger.parentWorkflowRunId,
    trigger.parent_workflow_run_id,
  ]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function resolveActiveStatus(
  status: WorkflowStatus,
): RunningWorkflowSummary['status'] | undefined {
  if (!ACTIVE_STATUSES.has(status)) {
    return undefined;
  }
  return status === WorkflowStatus.PENDING ? 'PENDING' : 'RUNNING';
}

/**
 * Project active workflow runs into neutral {@link RunningWorkflowSummary}
 * records: resolve display names, compute age against `nowMs`, exclude the
 * caller, sort oldest-first, and cap to the limit. Pure and deterministic so
 * it can back both the `list_running_workflows` tool and prompt auto-injection.
 */
export function mapRunningWorkflowSummaries(
  runs: RunningWorkflowRunRecord[],
  namesById: Map<string, string>,
  nowMs: number,
  options: MapRunningWorkflowSummariesOptions = {},
): RunningWorkflowSummary[] {
  const summaries = runs
    .filter((run) => run.id !== options.excludeRunId)
    .slice()
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .flatMap((run): RunningWorkflowSummary[] => {
      const status = resolveActiveStatus(run.status);
      if (!status) {
        return [];
      }

      const ageSeconds = Math.max(
        0,
        Math.trunc(
          (nowMs - run.created_at.getTime()) / MILLISECONDS_PER_SECOND,
        ),
      );
      const waitReason = resolveWaitReason(run.wait_reason);
      const parentRunId = resolveParentRunId(run.state_variables);

      return [
        {
          runId: run.id,
          workflowName: namesById.get(run.workflow_id) ?? run.workflow_id,
          status,
          ageSeconds,
          ...(waitReason ? { waitReason } : {}),
          ...(parentRunId ? { parentRunId } : {}),
        },
      ];
    });

  if (options.limit !== undefined && options.limit >= 0) {
    return summaries.slice(0, options.limit);
  }
  return summaries;
}
