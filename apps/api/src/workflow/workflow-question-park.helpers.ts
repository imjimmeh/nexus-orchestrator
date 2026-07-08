import { hasPersistedJobOutput } from './workflow-job-output.helpers';
import {
  ParkLogger,
  ParkedTurnEndAction,
} from './workflow-question-park.helpers.types';

export type { ParkLogger, ParkedTurnEndAction };

/**
 * Decide what to do when an agent's turn ends on a parked run.
 *
 * A run parked on a durable dependency wait (`wait_reason`, e.g.
 * await_agent_workflow) must never complete on a turn-end — its turn ended
 * because it requested the wait. A run parked on a user question is normally
 * suspended too, BUT a parked question container can be torn down (idle
 * teardown) and the step retried; the fresh execution may finish and persist
 * `set_job_output` without re-asking. In that case `awaiting_input` and its
 * pending `user_question_awaits` row are stale, and discarding the genuine
 * completion is exactly what wedges the run RUNNING forever. We distinguish the
 * two by persisted output: posing a question never persists job output,
 * finishing the job does. When completing through a stale question park, the
 * stale await is cancelled and the flag cleared before returning 'complete'.
 */
export async function resolveParkedTurnEnd(params: {
  run: { wait_reason?: string | null; awaiting_input?: boolean | null };
  workflowRunId: string;
  jobId: string;
  getVariable: (path: string) => Promise<unknown>;
  cancelOpenAwaits: (workflowRunId: string) => Promise<void>;
  clearAwaitingInput: (workflowRunId: string) => Promise<void>;
  logger: ParkLogger;
}): Promise<ParkedTurnEndAction> {
  if (params.run.wait_reason) {
    params.logger.log(
      `Run ${params.workflowRunId} is parked (wait_reason=${params.run.wait_reason}); suspending job ${params.jobId} turn-end without completing the run`,
    );
    return 'suspend';
  }

  if (!params.run.awaiting_input) {
    return 'complete';
  }

  const completedWithOutput = await hasPersistedJobOutput(
    params.getVariable,
    params.jobId,
  );
  if (!completedWithOutput) {
    params.logger.log(
      `Run ${params.workflowRunId} is parked awaiting user input; suspending job ${params.jobId} turn-end without completing the run`,
    );
    return 'suspend';
  }

  params.logger.warn(
    `Run ${params.workflowRunId} job ${params.jobId} finished with persisted output while awaiting_input was still set (stale question state after a retry); clearing it and completing the run`,
  );
  await params.cancelOpenAwaits(params.workflowRunId);
  await params.clearAwaitingInput(params.workflowRunId);
  return 'complete';
}

/**
 * True when a job failure is a transport timeout on a run parked on an open user
 * question — the expected consequence of the question-idle container being torn
 * down to free capacity. The caller must leave the run parked instead of
 * retrying (a retry would spawn a fresh execution that re-runs the whole step
 * and races the durable question lifecycle).
 */
export async function isIdleQuestionTeardownTimeout(params: {
  isTransportTimeout: boolean;
  awaitingInput: boolean | null | undefined;
  workflowRunId: string;
  findOpenAwait: (workflowRunId: string) => Promise<object | null>;
}): Promise<boolean> {
  if (!params.isTransportTimeout || !params.awaitingInput) {
    return false;
  }
  const openQuestion = await params.findOpenAwait(params.workflowRunId);
  return openQuestion !== null && openQuestion !== undefined;
}

/**
 * A retried step starts over in a fresh execution, so any user-question await
 * the prior execution left open is orphaned — the new run will not answer it.
 * Cancel it and clear `awaiting_input` so the retry begins from clean state and
 * the completion path is never blocked by a stale park flag. No-op when the run
 * was not parked.
 */
export async function clearOrphanedQuestionStateOnRetry(params: {
  awaitingInput: boolean | null | undefined;
  workflowRunId: string;
  cancelOpenAwaits: (workflowRunId: string) => Promise<void>;
  clearAwaitingInput: (workflowRunId: string) => Promise<void>;
}): Promise<void> {
  if (!params.awaitingInput) {
    return;
  }
  await params.cancelOpenAwaits(params.workflowRunId);
  await params.clearAwaitingInput(params.workflowRunId);
}
