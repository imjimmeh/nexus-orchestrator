import type { StepSupportService } from './step-support.service';
import type { StepAgentContainerSupportService } from './step-agent-container-support.service';
import type { StepContainerRuntimeService } from './step-container-runtime.service';
import type { WorkflowRunHeartbeatService } from '../workflow-run-operations/workflow-run-heartbeat.service';
import type { ExecutionHeartbeatService } from '../../execution-lifecycle/execution-heartbeat.service';

/**
 * Starts a job container and its log stream, recording run + execution
 * heartbeat activity on every log line. Extracted from
 * `StepAgentStepExecutorService` to keep that file under the project's
 * `max-lines` lint cap.
 */
export async function startContainerAndStreamLogsForJobCore(params: {
  containerId: string;
  runId: string;
  jobId: string;
  executionId?: string;
  containerSupport: Pick<StepAgentContainerSupportService, 'startContainer'>;
  containerRuntime: Pick<
    StepContainerRuntimeService,
    'startContainerLogStreaming'
  >;
  runHeartbeat: Pick<WorkflowRunHeartbeatService, 'recordActivity'>;
  executionHeartbeat: Pick<ExecutionHeartbeatService, 'recordActivity'>;
}): Promise<() => void> {
  await params.containerSupport.startContainer(params.containerId);
  return params.containerRuntime.startContainerLogStreaming(
    params.containerId,
    params.runId,
    params.jobId,
    () => {
      params.runHeartbeat.recordActivity(params.runId);
      if (params.executionId) {
        params.executionHeartbeat.recordActivity(
          params.executionId,
          'container_log',
        );
      }
    },
  );
}

/**
 * Cleans up a job's container resources (tool/skill mounts, worktree skill
 * cleanup, log-stream teardown). Extracted from `StepAgentStepExecutorService`
 * to keep that file under the project's `max-lines` lint cap.
 */
export async function cleanupJobContainerCore(params: {
  containerId: string;
  stopLogStreaming: (() => void) | null;
  workflowRunId: string;
  jobId: string;
  stepId: string;
  mountKey: string;
  stateVariables: Record<string, unknown>;
  support: Pick<StepSupportService, 'resolveWorktreePathFromTrigger'>;
  containerSupport: Pick<
    StepAgentContainerSupportService,
    'cleanupJobResources'
  >;
}): Promise<void> {
  let worktreePath: string | undefined;
  try {
    worktreePath = await params.support.resolveWorktreePathFromTrigger(
      params.stateVariables,
    );
  } catch {
    // worktree path not available, skip worktree skill cleanup
  }
  await params.containerSupport.cleanupJobResources({
    workflowRunId: params.workflowRunId,
    jobId: params.jobId,
    stepId: params.stepId,
    containerId: params.containerId,
    stopContainerLogStreaming: params.stopLogStreaming,
    toolMountKey: params.mountKey,
    skillMountKey: params.mountKey,
    worktreePath,
  });
}
