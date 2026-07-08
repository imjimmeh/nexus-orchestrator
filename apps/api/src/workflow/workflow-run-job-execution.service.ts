import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IWorkflowDefinition, WorkflowStatus } from '@nexus/core';
import { Queue } from 'bullmq';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { StateManagerService } from './state-manager.service';
import { WorkflowParserService } from './workflow-parser.service';
import { PromptLoaderService } from './prompt-loader.service';
import { DAGResolverService } from './dag-resolver.service';
import {
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_JOB_QUEUED_EVENT,
} from './workflow-events.constants';
import type {
  WorkflowJobEvent,
  WorkflowRunEvent,
} from './workflow-events.types';
import { tryActivateNextQueuedRun } from './workflow-run-job-execution.utils';
import type { QueuedRunActivationOutcome } from './workflow-run-job-execution.utils';
import { buildQueuedJobAuditPayload } from './workflow-job-audit-payload.utils';
import { fetchQueueJobsForRun } from './workflow-run-queue.utils';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';
import { buildWorkflowStepQueueJobId } from './workflow-job-identity.helpers';
import { JobCompletionHandler } from './job-completion.handler';
import type { JobCompletionHandlerDeps } from './job-completion.handler.types';
import { JobFailureHandler } from './job-failure.handler';
import type { JobFailureHandlerDeps } from './job-failure.handler.types';
import type { AgentRetryResume } from './job-execution.types';

@Injectable()
export class WorkflowRunJobExecutionService {
  private readonly logger = new Logger(WorkflowRunJobExecutionService.name);
  private readonly queueScanLimit = 5000;

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly stateManager: StateManagerService,
    private readonly dagResolver: DAGResolverService,
    private readonly parser: WorkflowParserService,
    private readonly promptLoader: PromptLoaderService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
    private readonly jobCompletionHandler: JobCompletionHandler,
    private readonly jobFailureHandler: JobFailureHandler,
  ) {}

  async removeQueuedJobsForRun(workflowRunId: string): Promise<number> {
    const candidateJobs = await fetchQueueJobsForRun({
      stepQueue: this.stepQueue,
      workflowRunId,
      queueScanLimit: this.queueScanLimit,
    });
    let removedCount = 0;
    for (const job of candidateJobs) {
      try {
        await job.remove();
        removedCount += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to remove queued job ${job.id} for workflow run ${workflowRunId}: ${(error as Error).message}`,
        );
      }
    }

    return removedCount;
  }

  async activateQueuedRun(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<QueuedRunActivationOutcome> {
    return tryActivateNextQueuedRun(
      { workflow_id: workflowId, concurrency_scope: concurrencyScope },
      this as never,
    );
  }

  /**
   * Terminally cancels a PENDING run that can never be activated. Idempotent:
   * a no-op if the run already left PENDING.
   */
  async cancelUnactivatablePendingRun(
    runId: string,
    reason: string,
  ): Promise<void> {
    const run = await this.runRepo.findById(runId);
    if (!run || run.status !== WorkflowStatus.PENDING) {
      return;
    }

    const now = new Date();
    await this.runRepo.update(runId, {
      status: WorkflowStatus.CANCELLED,
      ...buildRunStatusTimestampPatch(run, WorkflowStatus.CANCELLED, now),
    });

    this.eventEmitter.emit(WORKFLOW_RUN_CANCELLED_EVENT, {
      workflowRunId: runId,
      workflowId: run.workflow_id,
      status: WorkflowStatus.CANCELLED,
      stateVariables: run.state_variables ?? {},
      reason,
    } satisfies WorkflowRunEvent);

    this.logger.warn(
      `Cancelled unactivatable pending workflow run ${runId} (${reason})`,
    );
  }

  /**
   * Thin orchestrator for the success-path terminal-write trigger. The
   * implementation — including all guard clauses, persistence, event emission,
   * transition resolution, and DAG progression — lives in `JobCompletionHandler`
   * so this service stays focused on cross-cutting concerns (retry scheduling,
   * failure semantics, queue activation).
   */
  async handleJobComplete(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.jobCompletionHandler.handle(
      workflowRunId,
      jobId,
      output,
      this.buildJobCompletionDeps(),
    );
  }

  /**
   * Thin orchestrator for the failure-path terminal-write trigger. The
   * implementation — including all guard clauses, salvage detection, idle
   * question teardown handling, retry classification and scheduling, and the
   * terminal FAILED transition — lives in `JobFailureHandler` so the public
   * service stays focused on cross-cutting concerns (queue activation, shared
   * dependency wiring).
   */
  async handleJobFailed(
    workflowRunId: string,
    jobId: string,
    reason: string,
    resumeOverride?: AgentRetryResume,
  ): Promise<'ignored' | 'retry_scheduled' | 'failed' | 'salvaged'> {
    return await this.jobFailureHandler.handle(
      workflowRunId,
      jobId,
      reason,
      resumeOverride,
      this.buildJobFailureDeps(),
    );
  }

  /**
   * Builds the per-call dependency bag that `JobCompletionHandler` needs to
   * reach back into the orchestrator for shared concerns.
   */
  private buildJobCompletionDeps(): JobCompletionHandlerDeps {
    return {
      loadWorkflowDefinition: (workflowId) =>
        this.loadWorkflowDefinition(workflowId),
      enqueueJob: (workflowRunId, def, jobId) =>
        this.enqueueJob(workflowRunId, def, jobId),
      reportMaxLoopIterations: (workflowRunId, jobId, reason) =>
        this.reportMaxLoopIterationsInternal(workflowRunId, jobId, reason),
      tryActivateNextQueuedRun: (run) => this.activateNextQueuedRunFor(run),
    };
  }

  /**
   * Builds the per-call dependency bag that `JobFailureHandler` needs to reach
   * back into the orchestrator for shared concerns: workflow definition
   * loading, salvage completion (re-enters the completion handler via this
   * service's own `handleJobComplete`), and queued-run activation after a
   * terminal FAILED transition.
   */
  private buildJobFailureDeps(): JobFailureHandlerDeps {
    return {
      loadWorkflowDefinition: (workflowId) =>
        this.loadWorkflowDefinition(workflowId),
      completeJob: (workflowRunId, jobId, output) =>
        this.handleJobComplete(workflowRunId, jobId, output),
      tryActivateNextQueuedRun: (run) => this.activateNextQueuedRunFor(run),
    };
  }

  /**
   * Routes a max-loop-iteration failure back through `handleJobFailed`.
   * The handler declares the callback as `Promise<void>` because the failure
   * path already owns further handling; we discard the stringly-typed return
   * to keep the orchestrator's return contract intact.
   */
  private async reportMaxLoopIterationsInternal(
    workflowRunId: string,
    jobId: string,
    reason: string,
  ): Promise<void> {
    await this.handleJobFailed(workflowRunId, jobId, reason);
  }

  /**
   * Adapter that runs the queued-run activation against this service's own
   * repository/parser/prompt-loader, used by both handlers after a run reaches
   * its terminal COMPLETED or FAILED state.
   */
  private activateNextQueuedRunFor(run: {
    workflow_id: string;
    concurrency_scope?: string | null;
  }): Promise<QueuedRunActivationOutcome> {
    return tryActivateNextQueuedRun(run, this as never);
  }

  async enqueueJob(
    workflowRunId: string,
    def: IWorkflowDefinition,
    jobId: string,
  ): Promise<void> {
    const job = def.jobs?.find((candidate) => candidate.id === jobId);
    if (!job) {
      return;
    }

    if (!(await this.stateManager.tryMarkJobQueued(workflowRunId, jobId))) {
      this.logger.debug(
        `Skipping duplicate or inactive enqueue for job ${jobId} run ${workflowRunId}`,
      );
      return;
    }

    await this.stepQueue.add(
      'execute-job',
      {
        workflowRunId,
        jobId,
        job,
        workflowPermissions: def.permissions || undefined,
        workflowSkillDiscoveryMode: def.skill_discovery_mode || undefined,
        workflowYamlSkills: def.skills || undefined,
      },
      {
        jobId: buildWorkflowStepQueueJobId(workflowRunId, jobId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    this.logger.log(`Enqueued job ${jobId} for run ${workflowRunId}`);
    this.eventEmitter.emit(WORKFLOW_JOB_QUEUED_EVENT, {
      workflowRunId,
      workflowId: def.workflow_id,
      jobId,
      payload: buildQueuedJobAuditPayload(job, def.permissions),
    } satisfies WorkflowJobEvent);
  }

  private async loadWorkflowDefinition(
    workflowId: string,
  ): Promise<IWorkflowDefinition> {
    const workflow = await this.workflowRepo.findByIdentifier(workflowId, {
      includeInactive: true,
    });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    return this.promptLoader.resolveWorkflowPromptsWithRetry(
      this.parser.parseWorkflow(workflow.yaml_definition),
    );
  }
}
