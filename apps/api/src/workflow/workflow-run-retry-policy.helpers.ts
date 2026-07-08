import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IWorkflowDefinition, SkillDiscoveryMode } from '@nexus/core';
import { Queue } from 'bullmq';
import type { IWorkflowRunRepository } from './kernel/interfaces/workflow-kernel.ports';
import { SystemSettingsService } from '../settings/system-settings.service';
import { StateManagerService } from './state-manager.service';
import { getAutoRetryConfig } from './workflow-run-auto-retry-config.helpers';
import { resolveRetryDelayMs } from './workflow-run-backoff.helpers';
import {
  autoRetryAttemptPath,
  autoRetryFirstFailureAtPath,
  autoRetryLastFailurePath,
} from './workflow-run-retry-state.helpers';
import { WORKFLOW_RUN_RETRY_SCHEDULED_EVENT } from './workflow-events.constants';
import { buildAutoRetryQueueJobId } from './workflow-job-identity.helpers';
import type { AgentRetryResume } from './job-execution.types';

const AUTO_RETRY_QUEUE_JOB_ID_PREFIX = 'auto-retry-';

interface ScheduleWorkflowAutoRetryParams {
  run: {
    id: string;
    workflow_id: string;
  };
  jobId: string;
  reason: string;
  loadWorkflowDefinition: (workflowId: string) => Promise<IWorkflowDefinition>;
  stateManager: StateManagerService;
  runRepo: IWorkflowRunRepository;
  stepQueue: Queue;
  eventEmitter: EventEmitter2;
  systemSettings: SystemSettingsService;
  logger: Logger;
  reasonCode?: string;
  allowWhenWorkflowAutoRetryDisabled?: boolean;
  retryDelayMsOverride?: number;
  resetAt?: string;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: 'tokens';
  };
  resume?: AgentRetryResume;
}

export async function scheduleWorkflowAutoRetry(
  params: ScheduleWorkflowAutoRetryParams,
): Promise<boolean> {
  const retryConfig = await getAutoRetryConfig(params.systemSettings);
  if (
    !retryConfig.enabled &&
    params.allowWhenWorkflowAutoRetryDisabled !== true
  ) {
    return false;
  }

  const firstFailureAtVar = autoRetryFirstFailureAtPath(params.jobId);
  const firstFailureAt = (await params.stateManager.getVariable(
    params.run.id,
    firstFailureAtVar,
  )) as string | null;

  const retryContext = await resolveRetryContext({
    loadWorkflowDefinition: params.loadWorkflowDefinition,
    workflowId: params.run.workflow_id,
    stateManager: params.stateManager,
    runId: params.run.id,
    jobId: params.jobId,
    logger: params.logger,
    maxAttempts: retryConfig.maxAttempts,
    maxDurationMs: retryConfig.maxDurationMs,
    reasonCode: params.reasonCode,
    firstFailureAt,
  });

  params.logger.warn(
    `Retry decision for run ${params.run.id} job ${params.jobId}: retry=${!!retryContext}, reason=${params.reasonCode}, error="${params.reason}"`,
  );

  if (!retryContext) {
    return false;
  }
  if (
    !(await hasAutoRetryCapacity({
      stepQueue: params.stepQueue,
      maxInFlight: retryConfig.maxInFlight,
      logger: params.logger,
      runId: params.run.id,
      jobId: params.jobId,
    }))
  ) {
    return false;
  }
  const nextAttempt = retryContext.retryAttempt.currentAttempt + 1;
  const delayMs = resolveRetryDelayMs({
    retryConfig,
    nextAttempt,
    overrideDelayMs: params.retryDelayMsOverride,
  });
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + delayMs).toISOString();
  await enqueueRetryJob({
    runId: params.run.id,
    jobId: params.jobId,
    delayMs,
    reason: params.reason,
    reasonCode: params.reasonCode,
    resetAt: params.resetAt,
    nextRetryAt,
    providerTier: params.providerTier,
    usageLimit: params.usageLimit,
    resume: params.resume,
    job: retryContext.job,
    workflowPermissions: retryContext.def.permissions || undefined,
    workflowSkillDiscoveryMode:
      retryContext.def.skill_discovery_mode || undefined,
    workflowYamlSkills: retryContext.def.skills || undefined,
    stateManager: params.stateManager,
    runRepo: params.runRepo,
    stepQueue: params.stepQueue,
    retryAttemptPath: retryContext.retryAttempt.path,
    nextAttempt,
    firstFailureAt: firstFailureAt ?? now.toISOString(),
    firstFailureAtVar,
  });
  emitRetryScheduledTelemetry({
    eventEmitter: params.eventEmitter,
    logger: params.logger,
    runId: params.run.id,
    workflowId: params.run.workflow_id,
    jobId: params.jobId,
    nextAttempt,
    maxAttempts: retryConfig.maxAttempts,
    delayMs,
    resetAt: params.resetAt,
    nextRetryAt,
    providerTier: params.providerTier,
    usageLimit: params.usageLimit,
    reason: params.reason,
    reasonCode: params.reasonCode,
  });
  return true;
}

function emitRetryScheduledTelemetry(params: {
  eventEmitter: EventEmitter2;
  logger: Logger;
  runId: string;
  workflowId: string;
  jobId: string;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  resetAt?: string;
  nextRetryAt: string;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: 'tokens';
  };
  reason: string;
  reasonCode?: string;
}): void {
  params.eventEmitter.emit(WORKFLOW_RUN_RETRY_SCHEDULED_EVENT, {
    workflowRunId: params.runId,
    workflowId: params.workflowId,
    jobId: params.jobId,
    payload: {
      attempt: params.nextAttempt,
      maxAttempts: params.maxAttempts,
      delayMs: params.delayMs,
      reason: params.reason,
      reasonCode: params.reasonCode ?? 'generic_failure',
      resetAt: params.resetAt,
      nextRetryAt: params.nextRetryAt,
      providerTier: params.providerTier,
      usageLimit: params.usageLimit,
    },
  });
  params.logger.warn(
    `Scheduled workflow retry for run ${params.runId}, job ${params.jobId}, attempt ${params.nextAttempt}/${params.maxAttempts} in ${params.delayMs}ms`,
  );
}

async function enqueueRetryJob(params: {
  runId: string;
  jobId: string;
  delayMs: number;
  reason: string;
  reasonCode?: string;
  resetAt?: string;
  nextRetryAt: string;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: 'tokens';
  };
  resume?: AgentRetryResume;
  job: NonNullable<IWorkflowDefinition['jobs']>[number];
  workflowPermissions?: IWorkflowDefinition['permissions'];
  workflowSkillDiscoveryMode?: SkillDiscoveryMode;
  workflowYamlSkills?: string[];
  stateManager: StateManagerService;
  runRepo: IWorkflowRunRepository;
  stepQueue: Queue;
  retryAttemptPath: string;
  nextAttempt: number;
  firstFailureAt: string;
  firstFailureAtVar: string;
}): Promise<void> {
  const retryQueueJobId = buildAutoRetryQueueJobId(params.runId, params.jobId);
  await params.stateManager.setVariable(
    params.runId,
    params.retryAttemptPath,
    params.nextAttempt,
  );
  await params.stateManager.setVariable(
    params.runId,
    params.firstFailureAtVar,
    params.firstFailureAt,
  );
  await params.stateManager.setVariable(
    params.runId,
    autoRetryLastFailurePath(params.jobId),
    {
      reason: params.reason,
      message: params.reason,
      reasonCode: params.reasonCode ?? 'generic_failure',
      delayMs: params.delayMs,
      resetAt: params.resetAt,
      nextRetryAt: params.nextRetryAt,
      providerTier: params.providerTier,
      usageLimit: params.usageLimit,
      firstFailureAt: params.firstFailureAt,
      attempt: params.nextAttempt,
      retryQueueJobId,
    },
  );
  await params.runRepo.update(params.runId, { current_step_id: params.jobId });
  await params.stepQueue.add(
    'execute-job',
    {
      workflowRunId: params.runId,
      jobId: params.jobId,
      job: params.job,
      workflowPermissions: params.workflowPermissions,
      workflowSkillDiscoveryMode: params.workflowSkillDiscoveryMode,
      workflowYamlSkills: params.workflowYamlSkills,
      autoRetry: {
        attempt: params.nextAttempt,
        retryQueueJobId,
        resume: params.resume,
      },
    },
    {
      delay: params.delayMs,
      attempts: 1,
      backoff: { type: 'exponential', delay: 1000 },
      jobId: retryQueueJobId,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

async function resolveRetryAttempt(params: {
  stateManager: StateManagerService;
  runId: string;
  jobId: string;
  maxAttempts: number;
  maxDurationMs: number;
  reasonCode?: string;
  firstFailureAt?: string | null;
}): Promise<{
  path: string;
  currentAttempt: number;
} | null> {
  const path = autoRetryAttemptPath(params.jobId);
  const currentAttempt = toRetryAttemptNumber(
    await params.stateManager.getVariable(params.runId, path),
  );

  // Handle 429 Indefinite Retries with Duration Cap
  if (params.reasonCode === 'provider_rate_limit_429') {
    if (params.firstFailureAt) {
      const durationMs = Date.now() - new Date(params.firstFailureAt).getTime();
      if (durationMs >= params.maxDurationMs) {
        return null;
      }
    }
    return { path, currentAttempt };
  }

  if (currentAttempt >= params.maxAttempts) {
    return null;
  }

  return { path, currentAttempt };
}

function toRetryAttemptNumber(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

async function resolveRetryDefinitionAndJob(params: {
  loadWorkflowDefinition: (workflowId: string) => Promise<IWorkflowDefinition>;
  workflowId: string;
  jobId: string;
  logger: Logger;
}): Promise<{
  def: IWorkflowDefinition;
  job: NonNullable<IWorkflowDefinition['jobs']>[number];
} | null> {
  const def = await params.loadWorkflowDefinition(params.workflowId);
  const job = def.jobs?.find((candidate) => candidate.id === params.jobId);
  if (!job) {
    params.logger.warn(
      `Unable to schedule retry: job ${params.jobId} not found in workflow ${params.workflowId}`,
    );
    return null;
  }

  return { def, job };
}

async function resolveRetryContext(params: {
  loadWorkflowDefinition: (workflowId: string) => Promise<IWorkflowDefinition>;
  workflowId: string;
  stateManager: StateManagerService;
  runId: string;
  jobId: string;
  logger: Logger;
  maxAttempts: number;
  maxDurationMs: number;
  reasonCode?: string;
  firstFailureAt?: string | null;
}): Promise<{
  def: IWorkflowDefinition;
  job: NonNullable<IWorkflowDefinition['jobs']>[number];
  retryAttempt: {
    path: string;
    currentAttempt: number;
  };
} | null> {
  const definitionAndJob = await resolveRetryDefinitionAndJob({
    loadWorkflowDefinition: params.loadWorkflowDefinition,
    workflowId: params.workflowId,
    jobId: params.jobId,
    logger: params.logger,
  });
  if (!definitionAndJob) {
    return null;
  }

  const retryAttempt = await resolveRetryAttempt({
    stateManager: params.stateManager,
    runId: params.runId,
    jobId: params.jobId,
    maxAttempts: params.maxAttempts,
    maxDurationMs: params.maxDurationMs,
    reasonCode: params.reasonCode,
    firstFailureAt: params.firstFailureAt,
  });
  if (!retryAttempt) {
    return null;
  }

  return {
    def: definitionAndJob.def,
    job: definitionAndJob.job,
    retryAttempt,
  };
}

async function countInFlightAutoRetryJobs(
  stepQueue: Queue,
  maxInFlight: number,
): Promise<number> {
  const scanLimit = Math.max(maxInFlight * 20, 200);
  const liveJobs = await stepQueue.getJobs(
    ['active', 'waiting', 'delayed'],
    0,
    scanLimit,
  );

  return liveJobs.reduce((count, job) => {
    const rawJobId: unknown = job.id;
    let jobId = '';
    if (typeof rawJobId === 'string') {
      jobId = rawJobId;
    } else if (typeof rawJobId === 'number') {
      jobId = rawJobId.toString();
    }
    return jobId.startsWith(AUTO_RETRY_QUEUE_JOB_ID_PREFIX) ? count + 1 : count;
  }, 0);
}

async function hasAutoRetryCapacity(params: {
  stepQueue: Queue;
  maxInFlight: number;
  logger: Logger;
  runId: string;
  jobId: string;
}): Promise<boolean> {
  const inFlightAutoRetries = await countInFlightAutoRetryJobs(
    params.stepQueue,
    params.maxInFlight,
  );
  if (inFlightAutoRetries < params.maxInFlight) {
    return true;
  }

  params.logger.warn(
    `Skipping workflow auto-retry for run ${params.runId}, job ${params.jobId}: ` +
      `in-flight auto-retry limit reached (${inFlightAutoRetries}/${params.maxInFlight}).`,
  );
  return false;
}
