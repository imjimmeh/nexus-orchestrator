import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  IToolPermissionPolicy,
  IToolRegistry,
  IJob,
  ToolPolicyStrategy,
} from '@nexus/core';
import { StepExecutionOrchestratorService } from './step-execution-orchestrator.service';
import { StepSupportService } from './step-support.service';
import { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import { JobQueueData, StepJobData } from './step-execution.types';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { WorkflowAutoRetryActivationGuardService } from './workflow-auto-retry-activation-guard.service';
import { ServiceLifecycleStateService } from '../../execution-lifecycle/service-lifecycle-state.service';
import { sleep } from '../../common/utils/async.utils';

// The consumer now uses fire-and-poll dispatch: it returns quickly after
// creating an execution record and starting the agent in the background.
// The default 30s lock duration is sufficient since the consumer no longer
// blocks for the agent lifetime.  A modest duration guards against genuine
// worker crashes while keeping the queue responsive.
const STEP_JOB_LOCK_DURATION_MS = 30 * 1000;

@Injectable()
@Processor('workflow-steps', {
  concurrency: 4,
  lockDuration: STEP_JOB_LOCK_DURATION_MS,
})
export class StepExecutionConsumer extends WorkerHost {
  private readonly logger = new Logger(StepExecutionConsumer.name);

  constructor(
    private readonly orchestrator: StepExecutionOrchestratorService,
    private readonly support: StepSupportService,
    private readonly retryService: StepRequiredToolRetryService,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly autoRetryActivationGuard: WorkflowAutoRetryActivationGuardService,
    private readonly lifecycle: ServiceLifecycleStateService,
  ) {
    super();
  }

  // Compatibility wrappers preserved for unit tests while logic lives in extracted services.
  private resolveInvokedWorkflowId(job: IJob): string | undefined {
    return this.support.resolveInvokedWorkflowId(job);
  }

  private applyPolicyToToolNames(
    baseToolNames: Set<string>,
    candidateToolNames: Set<string>,
    policy: unknown,
  ): Set<string> {
    return this.support.applyPolicyToToolNames(
      baseToolNames,
      candidateToolNames,
      policy,
    );
  }

  private resolveAgentProfileFromJobInputs(
    resolvedJobInputs: Record<string, unknown>,
    job: IJob,
    stateVariables?: Record<string, unknown>,
  ): string | undefined {
    return this.support.resolveAgentProfileFromJobInputs(
      resolvedJobInputs,
      job,
      stateVariables,
    );
  }

  private selectToolsForJob(
    tools: IToolRegistry[],
    job: IJob,
  ): IToolRegistry[] {
    return this.support.selectToolsForJob(tools, job);
  }

  private async resolveAllowedToolNames(params: {
    tools: Array<{ name: string }>;
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    agentProfile?: string;
    policyStrategy?: ToolPolicyStrategy;
  }): Promise<Set<string>> {
    return this.support.resolveAllowedToolNames(params);
  }

  async buildUpstreamContext(
    workflowRunId: string,
    job: IJob,
  ): Promise<string> {
    return this.support.buildUpstreamContextForJob(workflowRunId, job);
  }

  extractStructuredOutput(response: string): Record<string, unknown> | null {
    return this.support.extractStructuredOutput(response);
  }

  resolveJobInputs(
    inputs: Record<string, unknown> | undefined,
    variables: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.support.resolveJobInputs(inputs, variables);
  }

  private async checkRequiredToolCallsAndRetry(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    containerId: string,
    workflowPermissions?: IToolPermissionPolicy,
  ): Promise<'retried' | 'proceed'> {
    return this.retryService.checkRequiredToolCallsAndRetry(
      workflowRunId,
      jobId,
      job,
      containerId,
      workflowPermissions,
    );
  }

  private async resolveWorktreePathFromTrigger(
    stateVariables: Record<string, unknown>,
  ): Promise<string | undefined> {
    return this.support.resolveWorktreePathFromTrigger(stateVariables);
  }

  /**
   * Pause the local BullMQ worker so it stops pulling NEW jobs. Local-only and
   * non-persistent: a fresh process starts unpaused, so no resume is required on
   * restart. Used by the shutdown freeze coordinator to drain the step queue.
   */
  async pauseWorker(): Promise<void> {
    if (!this.worker) {
      this.logger.warn('Cannot pause step worker: worker not initialized');
      return;
    }
    await this.worker.pause();
    this.logger.warn('Paused workflow-steps worker for shutdown drain');
  }

  async process(
    job: Job<JobQueueData | StepJobData, unknown>,
  ): Promise<unknown> {
    const data = job.data;

    // Block processing while the service is still booting/restoring state.
    while (this.lifecycle.phase === 'booting') {
      this.logger.log(
        `Waiting for service to finish booting before processing job ${job.id} (run ${data?.workflowRunId ?? '?'})...`,
      );
      await sleep(1000);
    }

    if (!this.lifecycle.isAcceptingWork()) {
      throw new Error(
        `Service is not accepting work (phase: ${this.lifecycle.phase})`,
      );
    }

    // Backward compatibility: if stepId present but jobId absent, treat as legacy
    if ('stepId' in data && !('jobId' in data)) {
      const legacyData = data;
      this.logger.log(
        `Processing legacy step ${legacyData.stepId} for run ${legacyData.workflowRunId}`,
      );
      // Convert legacy data to new format
      const convertedData: JobQueueData = {
        workflowRunId: legacyData.workflowRunId,
        jobId: legacyData.stepId,
        job: {
          id: legacyData.stepId,
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'default', prompt: '' }],
          ...(legacyData.step as Record<string, unknown>),
        },
        workflowPermissions: legacyData.workflowPermissions,
        resumeSessionTreeId: legacyData.resumeSessionTreeId,
        userMessage: legacyData.userMessage,
      };
      return this.orchestrator.dispatchJob(convertedData, job.id);
    }

    const queueData = data as JobQueueData;
    const { workflowRunId, jobId } = queueData;
    this.logger.log(`Processing job ${jobId} for run ${workflowRunId}`);
    if (
      await this.autoRetryActivationGuard.shouldSkipStaleAutoRetryJob({
        queueJobId: job.id,
        data: queueData,
      })
    ) {
      return { skipped: true, reason: 'stale_auto_retry' };
    }

    // The retry has cleared the staleness guard and is now executing, so it is no
    // longer "queued". Clear the pending-retry marker up front so the UI banner
    // reflects reality immediately instead of waiting for the job to finish.
    if (queueData.autoRetry) {
      await this.autoRetryActivationGuard.markAutoRetryActivated(queueData);
    }

    const result = await this.orchestrator.dispatchJob(queueData, job.id);

    // condition_false skips are immediate (no background execution started),
    // so we complete the job synchronously here as before.
    if (this.isConditionFalseSkipResult(result)) {
      this.logger.log(
        `Completing job ${jobId} early because it was skipped by condition`,
      );
      await this.runExecution.handleJobComplete(workflowRunId, jobId, {
        skipped: true,
      });
    }

    return result;
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<JobQueueData | StepJobData, unknown> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    if (this.shouldSkipFinalFailureHandling(job)) {
      return;
    }

    const failedContext = this.extractFailedJobContext(job.data);
    if (!failedContext) {
      return;
    }

    try {
      await this.runExecution.handleJobFailed(
        failedContext.workflowRunId,
        failedContext.jobId,
        error?.message || 'Unknown workflow job failure',
      );
    } catch (handlerError) {
      const err =
        handlerError instanceof Error
          ? handlerError
          : new Error(String(handlerError));
      this.logger.error(
        `Failed to finalize failed job ${failedContext.jobId} for run ${failedContext.workflowRunId}: ${err.message}`,
        err.stack,
      );
    }
  }

  private shouldSkipFinalFailureHandling(
    job: Job<JobQueueData | StepJobData, unknown>,
  ): boolean {
    const maxAttempts =
      typeof job.opts.attempts === 'number' && job.opts.attempts > 0
        ? job.opts.attempts
        : 1;

    return job.attemptsMade < maxAttempts;
  }

  private extractFailedJobContext(
    data: JobQueueData | StepJobData,
  ): { workflowRunId: string; jobId: string } | null {
    const workflowRunId =
      data && typeof data === 'object' && 'workflowRunId' in data
        ? data.workflowRunId
        : undefined;
    const jobId =
      data && typeof data === 'object' && 'jobId' in data
        ? data.jobId
        : undefined;

    if (typeof workflowRunId !== 'string' || typeof jobId !== 'string') {
      return null;
    }

    return { workflowRunId, jobId };
  }

  private isConditionFalseSkipResult(
    result: unknown,
  ): result is { skipped: true; reason: 'condition_false' } {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const record = result as Record<string, unknown>;
    return record.skipped === true && record.reason === 'condition_false';
  }
}
