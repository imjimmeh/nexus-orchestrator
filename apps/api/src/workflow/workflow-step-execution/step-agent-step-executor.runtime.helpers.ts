import type { IJob } from '@nexus/core';
import { asRecord, getNestedValue } from '@nexus/core';
import Docker from 'dockerode';
import { Logger } from '@nestjs/common';
import type { ChatSessionDomainPort } from '../domain-ports';
import { JobQueueData } from './step-execution.types';
import {
  readFirstString,
  normalizeIdentifier,
} from '../workflow-stage-skill-policy.helpers';
import { buildExecutionMountKey } from '../workflow-job-identity.helpers';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import type { StepRequiredToolRetryService } from './step-required-tool-retry.service';

/**
 * Derives the container tool-mount key and the first step's id for a job.
 * Pure — extracted from `StepAgentStepExecutorService` to keep that file
 * under the project's `max-lines` lint cap.
 */
export function resolveExecutionIdentifiersCore(
  workflowRunId: string,
  jobId: string,
  job: IJob,
  bullJobId: string | number | undefined,
): { mountKey: string; stepId: string } {
  const mountKey = buildExecutionMountKey({
    workflowRunId,
    jobId,
    bullJobId,
  });
  const stepId = Array.isArray(job.steps)
    ? (job.steps[0]?.id ?? 'default')
    : 'default';

  return { mountKey, stepId };
}

export async function resolveContainerIpAddress(
  docker: Docker,
  containerId: string,
): Promise<string> {
  const container = docker.getContainer(containerId);
  const inspected = (await container.inspect()) as unknown as {
    NetworkSettings: {
      IPAddress: string;
      Networks: Record<string, { IPAddress: string }>;
    };
  };

  const networkName =
    process.env.NEXUS_DOCKER_NETWORK?.trim() || 'nexus-network';
  const networkInfo = inspected.NetworkSettings.Networks[networkName];

  if (networkInfo?.IPAddress) {
    return networkInfo.IPAddress;
  }

  if (inspected.NetworkSettings.IPAddress) {
    return inspected.NetworkSettings.IPAddress;
  }

  throw new Error(
    `Could not determine IP address for container ${containerId} on network '${networkName}'`,
  );
}

export async function injectPreviousSessionCore(params: {
  containerId: string;
  stateVariables: Record<string, unknown>;
  logger: Logger;
  sessionHydration: Pick<ChatSessionDomainPort, 'injectSessionIntoContainer'>;
  resumeSessionTreeId?: string;
}): Promise<void> {
  let sessionTreeId: string | undefined = params.resumeSessionTreeId;

  if (!sessionTreeId && shouldInjectPreviousSession(params.stateVariables)) {
    sessionTreeId = getNestedValue(
      params.stateVariables,
      'trigger.context.metadata.lastSessionTreeId'.split('.'),
    ) as string | undefined;
  }

  if (typeof sessionTreeId !== 'string' || sessionTreeId.length === 0) {
    return;
  }

  params.logger.log(
    `Injecting previous session ${sessionTreeId} into container ${params.containerId}`,
  );
  await params.sessionHydration.injectSessionIntoContainer(
    params.containerId,
    sessionTreeId,
  );
}

function shouldInjectPreviousSession(
  stateVariables: Record<string, unknown>,
): boolean {
  const trigger = asRecord(stateVariables.trigger);
  const dispatchTargetStage = readFirstString([
    trigger?.dispatch_target_status,
    trigger?.dispatchTargetStatus,
    trigger?.lifecycle_stage,
    trigger?.lifecycleStage,
  ]);
  const fromLifecycleStage = readFirstString([
    trigger?.from_lifecycle_stage,
    trigger?.fromLifecycleStage,
  ]);

  if (
    fromLifecycleStage &&
    normalizeIdentifier(fromLifecycleStage) === 'review' &&
    dispatchTargetStage &&
    normalizeIdentifier(dispatchTargetStage) === 'implementation'
  ) {
    return true;
  }

  return hasRejectionSignal(stateVariables);
}

function hasRejectionSignal(stateVariables: Record<string, unknown>): boolean {
  const rejectionCandidateKeys = [
    'trigger.rejectionFeedback',
    'trigger.failedDeliverables',
    'trigger.failed_deliverables',
    'trigger.executionConfig.rejectionFeedback',
    'trigger.executionConfig.failedDeliverables',
    'trigger.executionConfig.failed_deliverables',
  ];

  return rejectionCandidateKeys.some((path) => {
    const value = getNestedValue(stateVariables, path.split('.'));

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return value !== undefined && value !== null;
  });
}

export async function saveSessionAndUpdateResourceCore(params: {
  containerId: string;
  workflowRunId: string;
  stateVariables: Record<string, unknown>;
  sessionHydration: Pick<
    ChatSessionDomainPort,
    'saveSessionFromExitedContainer'
  >;
}): Promise<string | null> {
  const sessionTreeId =
    await params.sessionHydration.saveSessionFromExitedContainer(
      params.containerId,
      params.workflowRunId,
    );
  return sessionTreeId;
}

/**
 * Re-enqueues a job on fallback-chain advance, carrying forward the
 * workflow-level permissions/skill-discovery-mode/YAML skills from the
 * originating `JobQueueData` so a retried step doesn't silently diverge from
 * the first attempt's available capability. Extracted from
 * `StepAgentStepExecutorService` to keep that file under the project's
 * `max-lines` lint cap.
 */
export async function retryJobCarryingWorkflowSkillsCore(
  workflowEngine: IWorkflowEngineService,
  data: JobQueueData,
  args: { runId: string; failedJobId: string; retryPrompt: string },
): Promise<void> {
  await workflowEngine.retryJobWithMessage(
    args.runId,
    args.failedJobId,
    data.job,
    undefined,
    args.retryPrompt,
    data.workflowPermissions,
    data.workflowSkillDiscoveryMode,
    data.workflowYamlSkills,
  );
}

/**
 * Delegates required-tool-call/output-contract retry checks, threading the
 * same workflow-level fields as `retryJobCarryingWorkflowSkillsCore` above.
 */
export function checkRequiredToolRetryForJobCore(
  requiredToolRetry: StepRequiredToolRetryService,
  params: {
    workflowRunId: string;
    jobId: string;
    job: IJob;
    data: JobQueueData;
  },
  containerId: string,
): Promise<'retried' | 'proceed'> {
  return requiredToolRetry.checkRequiredToolCallsAndRetryJob(
    params.workflowRunId,
    params.jobId,
    params.job,
    containerId,
    params.data.workflowPermissions,
    params.data.workflowSkillDiscoveryMode,
    params.data.workflowYamlSkills,
  );
}
