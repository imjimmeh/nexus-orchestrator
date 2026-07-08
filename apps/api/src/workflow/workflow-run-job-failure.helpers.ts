import { Logger } from '@nestjs/common';
import type { ISessionHydrationService } from '../shared/interfaces/session-hydration.interface';
import type { AgentRetryResume } from './job-execution.types';
import type { StateManagerService } from './state-manager.service';

/**
 * Circuit breaker for consecutive container health check timeouts.
 *
 * Returns `false` (suppress retry) on the second consecutive occurrence,
 * `true` on the first (recording the failure so the next hit trips the
 * breaker).
 */
export async function applyHealthCheckCircuitBreaker(params: {
  stateManager: Pick<StateManagerService, 'getVariable' | 'setVariable'>;
  logger: Pick<Logger, 'error'>;
  workflowRunId: string;
  jobId: string;
}): Promise<boolean> {
  const key = `_internal.container_health_check_failed.${params.jobId}`;
  const alreadyFailed = await params.stateManager.getVariable(
    params.workflowRunId,
    key,
  );
  if (alreadyFailed) {
    params.logger.error(
      `Skipping auto-retry for consecutive container health check failure in run ${params.workflowRunId}, job ${params.jobId}`,
    );
    return false;
  }
  await params.stateManager.setVariable(params.workflowRunId, key, true);
  return true;
}

/**
 * Looks up the persisted session tree for the run and returns a resume ref
 * that the retry consumer can use to re-enter the same agent session after a
 * transient agent/provider failure.
 * Returns `undefined` when no tree record exists yet.
 */
export async function resolveWorkflowAgentResume(params: {
  sessionHydration: Pick<
    ISessionHydrationService,
    'findSessionTreeByWorkflowRunId'
  >;
  workflowRunId: string;
}): Promise<AgentRetryResume | undefined> {
  const tree = await params.sessionHydration.findSessionTreeByWorkflowRunId(
    params.workflowRunId,
  );
  return tree?.id ? { resumeSessionTreeId: tree.id } : undefined;
}
