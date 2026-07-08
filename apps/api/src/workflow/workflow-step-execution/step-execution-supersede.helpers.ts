import { isTerminalState } from '../../execution-lifecycle/execution-transition.helpers';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';

/**
 * Cancels every non-terminal execution for the same (run, job) so the
 * incoming attempt is the single source of truth. The completion listener
 * skips events from cancelled executions, which prevents a replaced
 * attempt's container teardown from consuming an extra auto-retry attempt.
 */
export async function supersedePriorExecutions(params: {
  executionRepo: Pick<
    ExecutionRepository,
    'findByWorkflowRunAndJob' | 'applyTransition'
  >;
  workflowRunId: string;
  jobId: string;
  log: (message: string) => void;
}): Promise<string[]> {
  const { executionRepo, workflowRunId, jobId, log } = params;
  const priorExecutions = await executionRepo.findByWorkflowRunAndJob(
    workflowRunId,
    jobId,
  );

  const supersededContainerIds: string[] = [];

  for (const prior of priorExecutions) {
    if (isTerminalState(prior.state)) {
      continue;
    }

    await executionRepo.applyTransition(prior.id, 'cancelled', {
      failure_reason: 'superseded',
      error_message: `Superseded by a newer execution for job ${jobId}`,
    });

    if (prior.container_id) {
      supersededContainerIds.push(prior.container_id);
    }

    log(
      `Superseded prior execution ${prior.id} for job ${jobId} in run ${workflowRunId}`,
    );
  }

  return supersededContainerIds;
}
