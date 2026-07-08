import { Logger } from '@nestjs/common';
import type { StepCompletionFinalizerDep } from './types';
import type { AuthenticatedSocket } from './types';

const logger = new Logger('TelemetryGatewayAgentEndFinalizerHelpers');

/**
 * Durably finalizes the parent workflow step on agent_end so completion
 * survives API restarts. Best-effort: errors are logged but never rethrown
 * to ensure a finalizer failure never disrupts telemetry ingestion.
 *
 * executions.context_id is the jobId (step-execution-orchestrator.service.ts
 * line 229). Falls back to stepId for older harnesses without jobId in JWT.
 */
export async function tryFinalizeParentStep(params: {
  client: AuthenticatedSocket;
  hasFailure: boolean;
  failureMessage: string | undefined;
  finalizer: StepCompletionFinalizerDep | undefined;
}): Promise<void> {
  const { client, hasFailure, failureMessage, finalizer } = params;
  if (!finalizer || !client.workflowRunId) {
    return;
  }
  const contextId = client.jobId ?? client.stepId;
  if (!contextId) {
    return;
  }
  try {
    await finalizer.finalizeFromAgentEnd({
      workflowRunId: client.workflowRunId,
      contextId,
      hasFailure,
      failureMessage,
    });
  } catch (e) {
    logger.warn(
      `[agent_end] durable step finalizer failed for run ${client.workflowRunId}: ${(e as Error).message}`,
    );
  }
}
