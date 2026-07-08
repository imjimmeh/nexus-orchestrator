import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isRecord, WorkflowStatus } from '@nexus/core';
import { Queue } from 'bullmq';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRun } from './database/entities/workflow-run.entity';
import { SystemSettingsService } from '../settings/system-settings.service';
import { StateManagerService } from './state-manager.service';
import { WorkflowTerminalRunCloserService } from './workflow-terminal-run-closer.service';
import { WorkflowRunQuestionParkService } from './workflow-run-question-park.service';
import {
  applyHealthCheckCircuitBreaker,
  resolveWorkflowAgentResume,
} from './workflow-run-job-failure.helpers';
import {
  AGENT_TRANSPORT_TIMEOUT_PATTERN,
  matchesProviderAbortFinishReason,
} from './workflow-failure-classification.helpers';
import { isNonRetryableWorkflowFailure } from './workflow-non-retryable-failures.helpers';
import { resolveWorkflowRetryDecision } from './workflow-provider-overload-retry.helpers';
import { scheduleWorkflowAutoRetry } from './workflow-run-retry-policy.helpers';
import {
  autoRetryLastFailurePath,
  clearAutoRetryState,
} from './workflow-run-retry-state.helpers';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';
import { WORKFLOW_RUN_FAILED_EVENT } from './workflow-events.constants';
import type { WorkflowRunEvent } from './workflow-events.types';
import {
  hasPersistedJobOutput,
  jobOutputStatePath,
} from './workflow-job-output.helpers';
import type { AgentRetryResume } from './job-execution.types';
import {
  SESSION_HYDRATION_SERVICE,
  type ISessionHydrationService,
} from '../shared/interfaces/session-hydration.interface';
import type { JobFailureHandlerDeps } from './job-failure.handler.types';

export type { JobFailureHandlerDeps } from './job-failure.handler.types';

/**
 * Owns the failure-path terminal-write logic for workflow runs.
 *
 * Originally lived inline in `WorkflowRunJobExecutionService.handleJobFailed`
 * as a 115+ LOC method with deeply nested control flow on salvage / idle
 * question teardown / retry-decision / circuit-breaker / scheduled-retry /
 * terminal FAILED branches. Extracted here so the public service stays a thin
 * orchestrator and the failure hot path becomes a small, named, testable
 * surface.
 *
 * Behavior is preserved byte-for-byte against the original implementation.
 */
@Injectable()
export class JobFailureHandler {
  private readonly logger = new Logger(JobFailureHandler.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly stateManager: StateManagerService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
    private readonly systemSettings: SystemSettingsService,
    private readonly terminalRunCloser: WorkflowTerminalRunCloserService,
    @Inject(SESSION_HYDRATION_SERVICE)
    private readonly sessionHydration: ISessionHydrationService,
    private readonly questionPark: WorkflowRunQuestionParkService,
  ) {}

  /**
   * Encapsulates the full failure-path decision tree:
   *   1. guard clauses (run missing / not RUNNING) → `'ignored'`
   *   2. salvage on transport timeout with persisted output → `'salvaged'`
   *   3. idle-question teardown timeout → `'ignored'`
   *   4. schedule a retry (or skip) based on classification and policy → `'retry_scheduled'`
   *   5. otherwise transition the run to terminal FAILED → `'failed'`
   *
   * Each branch is delegated to a small private method so this top-level
   * flow stays a linear reading of the decision tree.
   */
  async handle(
    workflowRunId: string,
    jobId: string,
    reason: string,
    resumeOverride: AgentRetryResume | undefined,
    deps: JobFailureHandlerDeps,
  ): Promise<'ignored' | 'retry_scheduled' | 'failed' | 'salvaged'> {
    const run = await this.loadRunOrIgnore(workflowRunId, jobId);
    if (!run) {
      return 'ignored';
    }

    const isTransportTimeout = this.matchesTransportTimeout(reason);

    // Salvage: if an agent step's dispatch connection dropped but it already
    // persisted its output via set_job_output, treat it as complete rather than
    // restarting hours of work.
    const salvagedOutput = await this.findSalvageableOutput(
      workflowRunId,
      jobId,
      isTransportTimeout,
    );
    if (salvagedOutput) {
      this.logger.warn(
        `Salvaging job ${jobId} in run ${workflowRunId}: transport timeout but set_job_output already persisted`,
      );
      await deps.completeJob(workflowRunId, jobId, salvagedOutput);
      return 'salvaged';
    }

    // A transport timeout on a run parked on an open user question is the
    // expected consequence of the question-idle container being torn down to
    // free capacity (the answer path resumes from the persisted session tree).
    // Retrying spawns a fresh execution that re-runs the whole step and races
    // the durable question lifecycle. Leave the run cleanly parked instead.
    if (
      await this.questionPark.isIdleQuestionTeardownTimeout(
        isTransportTimeout,
        run,
      )
    ) {
      return 'ignored';
    }

    if (await this.hasPendingAutoRetry(workflowRunId, jobId)) {
      this.logger.warn(
        `Run ${workflowRunId} job ${jobId} reported a duplicate failure while an auto-retry is still pending; leaving run RUNNING`,
      );
      return 'retry_scheduled';
    }

    const retryScheduled = await this.tryScheduleRetry(
      workflowRunId,
      jobId,
      run,
      reason,
      resumeOverride,
      isTransportTimeout,
      deps,
    );
    if (retryScheduled) {
      // A retried step starts over in a fresh execution. Any user-question
      // await the prior execution left open is orphaned — cancel it and clear
      // awaiting_input so the retry begins clean and its completion is never
      // blocked by a stale park flag.
      await this.questionPark.clearOrphanedQuestionStateOnRetry(run);
      return 'retry_scheduled';
    }

    return await this.failRun(workflowRunId, jobId, run, reason, deps);
  }

  /**
   * Resolves the run and applies the two guard clauses that must hold before
   * a failure trigger can advance the workflow: the run still exists, and the
   * run is RUNNING. Returns the loaded run on success, or `null` when any
   * guard fails (with the appropriate diagnostic already logged).
   */
  private async loadRunOrIgnore(
    workflowRunId: string,
    jobId: string,
  ): Promise<WorkflowRun | null> {
    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      return null;
    }

    if (run.status !== WorkflowStatus.RUNNING) {
      this.logger.warn(
        `Run ${workflowRunId} is not RUNNING, ignoring failure of ${jobId}`,
      );
      return null;
    }

    return run;
  }

  /**
   * Returns the persisted job output when the failure reason matches a
   * transport timeout AND the job actually wrote output via set_job_output.
   * Returns `null` for non-transport failures, transport failures without
   * persisted output, or transport failures with an empty/missing output.
   */
  private async findSalvageableOutput(
    workflowRunId: string,
    jobId: string,
    isTransportTimeout: boolean,
  ): Promise<Record<string, unknown> | null> {
    if (!isTransportTimeout) {
      return null;
    }

    const output = (await this.stateManager.getVariable(
      workflowRunId,
      jobOutputStatePath(jobId),
    )) as Record<string, unknown> | null;

    if (
      !output ||
      !(await hasPersistedJobOutput(
        (path) => this.stateManager.getVariable(workflowRunId, path),
        jobId,
      ))
    ) {
      return null;
    }

    return output;
  }

  /**
   * Centralizes the regex check against the canonical transport-timeout
   * pattern, so the call sites read as a single boolean intent.
   */
  private matchesTransportTimeout(reason: string): boolean {
    return AGENT_TRANSPORT_TIMEOUT_PATTERN.test(reason);
  }

  /**
   * Walks the retry decision tree: applies the non-retryable classification,
   * the container-health-check circuit breaker, and the provider-aware retry
   * policy. Returns `true` when a retry was scheduled on the queue.
   *
   * When classification rejects the failure as non-retryable, logs the
   * diagnostic warning that the original implementation emits in the same
   * shape before falling through to terminal failure.
   */
  private async tryScheduleRetry(
    workflowRunId: string,
    jobId: string,
    run: WorkflowRun,
    reason: string,
    resumeOverride: AgentRetryResume | undefined,
    isTransportTimeout: boolean,
    deps: JobFailureHandlerDeps,
  ): Promise<boolean> {
    let shouldRetry = !isNonRetryableWorkflowFailure({ jobId, reason });

    if (shouldRetry && reason.includes('Container health check timed out')) {
      shouldRetry = await applyHealthCheckCircuitBreaker({
        stateManager: this.stateManager,
        logger: this.logger,
        workflowRunId,
        jobId,
      });
    }

    if (!shouldRetry) {
      if (isNonRetryableWorkflowFailure({ jobId, reason })) {
        this.logger.warn(
          `Skipping auto-retry for non-retryable failure in run ${workflowRunId}, job ${jobId}: ${reason}`,
        );
      }
      return false;
    }

    const retryDecision = await resolveWorkflowRetryDecision({
      reason,
      systemSettings: this.systemSettings,
    });
    const shouldResumeAgentSession =
      isTransportTimeout || matchesProviderAbortFinishReason(reason);
    const resume =
      resumeOverride ??
      (shouldResumeAgentSession
        ? await resolveWorkflowAgentResume({
            sessionHydration: this.sessionHydration,
            workflowRunId,
          })
        : undefined);

    return await scheduleWorkflowAutoRetry({
      run,
      jobId,
      reason,
      loadWorkflowDefinition: (workflowId) =>
        deps.loadWorkflowDefinition(workflowId),
      stateManager: this.stateManager,
      runRepo: this.runRepo,
      stepQueue: this.stepQueue,
      eventEmitter: this.eventEmitter,
      systemSettings: this.systemSettings,
      logger: this.logger,
      ...retryDecision,
      resume,
    });
  }

  private async hasPendingAutoRetry(
    workflowRunId: string,
    jobId: string,
  ): Promise<boolean> {
    const retryMarker = await this.stateManager.getVariable(
      workflowRunId,
      autoRetryLastFailurePath(jobId),
    );

    if (!isRecord(retryMarker)) {
      return false;
    }

    const { nextRetryAt } = retryMarker;
    if (typeof nextRetryAt !== 'string') {
      return false;
    }

    const retryAtMs = Date.parse(nextRetryAt);
    return Number.isFinite(retryAtMs);
  }

  /**
   * Transitions the run to its terminal FAILED state, emits the run-failed
   * event with timestamp-safe semantics (never overwrite an already-set
   * `completed_at`), closes the run's queued jobs and managed containers,
   * logs the failure, and hands the concurrency scope back to the queue so a
   * queued sibling run can activate.
   */
  private async failRun(
    workflowRunId: string,
    jobId: string,
    run: WorkflowRun,
    reason: string,
    deps: JobFailureHandlerDeps,
  ): Promise<'failed'> {
    // No retry was scheduled, so the run is failing for good. Clear the pending
    // auto-retry marker; otherwise the UI would render a "waiting on retry"
    // banner over a terminally failed run instead of its error.
    await clearAutoRetryState(this.stateManager, workflowRunId, jobId);

    await this.runRepo.update(workflowRunId, {
      status: WorkflowStatus.FAILED,
      ...buildRunStatusTimestampPatch(run, WorkflowStatus.FAILED, new Date()),
    });

    const failureReason = `job_failed_after_retries: ${reason}`;
    this.eventEmitter.emit(WORKFLOW_RUN_FAILED_EVENT, {
      workflowRunId,
      workflowId: run.workflow_id,
      status: WorkflowStatus.FAILED,
      stateVariables: run.state_variables ?? {},
      reason: failureReason,
      failedJobId: jobId,
      errorMessage: failureReason,
    } satisfies WorkflowRunEvent);

    await this.terminalRunCloser.closeFailedRun({
      workflowRunId,
      workflowId: run.workflow_id,
      failedJobId: jobId,
      reason: failureReason,
    });

    this.logger.error(
      `Workflow run ${workflowRunId} failed after job ${jobId} exhausted retries: ${reason}`,
    );

    await deps.tryActivateNextQueuedRun(run);
    return 'failed';
  }
}
