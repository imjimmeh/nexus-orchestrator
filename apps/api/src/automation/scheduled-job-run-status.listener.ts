import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ScheduledJobRunStatus } from '@nexus/core';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ScheduledJobRunRepository } from './database/repositories/scheduled-job-run.repository';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { ScheduledJobRun } from './database/entities/scheduled-job-run.entity';

@Injectable()
export class ScheduledJobRunStatusListener {
  constructor(private readonly runRepository: ScheduledJobRunRepository) {}

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  async onRunStartedOrResumed(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: ScheduledJobRunStatus.RUNNING,
    });
  }

  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  async onRunPaused(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: ScheduledJobRunStatus.RUNNING,
    });
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: ScheduledJobRunStatus.SUCCEEDED,
      finished_at: new Date(),
    });
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: ScheduledJobRunStatus.FAILED,
      finished_at: new Date(),
      error_code: 'workflow_failed',
      error_message: 'Linked workflow run failed',
    });
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: ScheduledJobRunStatus.CANCELLED,
      finished_at: new Date(),
      error_code: 'workflow_cancelled',
      error_message: 'Linked workflow run was cancelled',
    });
  }

  private async applyUpdate(
    workflowRunId: string,
    update: QueryDeepPartialEntity<ScheduledJobRun>,
  ): Promise<void> {
    await this.runRepository.updateByWorkflowRunId(workflowRunId, update);
  }
}
