import { Injectable, Inject, Logger } from '@nestjs/common';
import { isRecord, WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { StateManagerService } from '../state-manager.service';
import type { JobQueueData } from '../job-execution.types';
import {
  autoRetryAttemptPath,
  autoRetryLastFailurePath,
  clearAutoRetryPendingMarker,
} from '../workflow-run-retry-state.helpers';

const AUTO_RETRY_QUEUE_JOB_ID_PREFIX = 'auto-retry-';

@Injectable()
export class WorkflowAutoRetryActivationGuardService {
  private readonly logger = new Logger(
    WorkflowAutoRetryActivationGuardService.name,
  );

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly stateManager: StateManagerService,
  ) {}

  /**
   * Marks an auto-retry job as activated by clearing its pending-retry marker.
   * Call once the job has passed {@link shouldSkipStaleAutoRetryJob} and is about
   * to dispatch: the retry is no longer queued, so the "waiting on retry" banner
   * must clear immediately rather than lingering until the job completes.
   */
  async markAutoRetryActivated(data: JobQueueData): Promise<void> {
    await clearAutoRetryPendingMarker(
      this.stateManager,
      data.workflowRunId,
      data.jobId,
    );
  }

  async shouldSkipStaleAutoRetryJob(params: {
    queueJobId: string | number | undefined;
    data: JobQueueData;
  }): Promise<boolean> {
    const queueJobId = this.normalizeQueueJobId(params.queueJobId);
    const autoRetry = params.data.autoRetry;
    if (!queueJobId.startsWith(AUTO_RETRY_QUEUE_JOB_ID_PREFIX)) {
      if (autoRetry) {
        this.logger.warn(
          `Skipping auto-retry job ${queueJobId || '<missing>'}: queue id is missing or does not use the auto-retry prefix`,
        );
        return true;
      }

      return false;
    }

    if (!autoRetry) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: missing autoRetry metadata`,
      );
      return true;
    }

    if (autoRetry.retryQueueJobId !== queueJobId) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: queue id does not match metadata`,
      );
      return true;
    }

    const run = await this.runRepo.findById(params.data.workflowRunId);
    if (!run) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: workflow run ${params.data.workflowRunId} no longer exists`,
      );
      return true;
    }

    if (run.status !== WorkflowStatus.RUNNING) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: workflow run ${params.data.workflowRunId} is ${run.status}`,
      );
      return true;
    }

    if (run.current_step_id !== params.data.jobId) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: current step ${run.current_step_id ?? 'none'} does not match ${params.data.jobId}`,
      );
      return true;
    }

    const [attemptValue, lastFailureValue] = await Promise.all([
      this.stateManager.getVariable(
        params.data.workflowRunId,
        autoRetryAttemptPath(params.data.jobId),
      ),
      this.stateManager.getVariable(
        params.data.workflowRunId,
        autoRetryLastFailurePath(params.data.jobId),
      ),
    ]);

    if (this.toAttemptNumber(attemptValue) !== autoRetry.attempt) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: attempt metadata is stale`,
      );
      return true;
    }

    if (!isRecord(lastFailureValue)) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: last failure metadata is malformed`,
      );
      return false;
    }
    const lastFailure = lastFailureValue;
    if (!this.matchesLastFailure(lastFailure, queueJobId, autoRetry.attempt)) {
      this.logger.warn(
        `Skipping auto-retry job ${queueJobId}: last failure metadata is stale`,
      );
      return true;
    }

    return false;
  }

  private matchesLastFailure(
    lastFailure: Record<string, unknown>,
    queueJobId: string,
    attempt: number,
  ): boolean {
    return (
      lastFailure.retryQueueJobId === queueJobId &&
      this.toAttemptNumber(lastFailure.attempt) === attempt
    );
  }

  private normalizeQueueJobId(value: string | number | undefined): string {
    if (typeof value === 'number') {
      return value.toString();
    }

    return value ?? '';
  }

  private toAttemptNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.trunc(parsed);
  }
}
