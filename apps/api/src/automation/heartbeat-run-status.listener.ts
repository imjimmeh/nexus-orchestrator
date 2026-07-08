import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HeartbeatRunStatus } from '@nexus/core';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { HeartbeatRun } from './database/entities/heartbeat-run.entity';
import { HeartbeatRunRepository } from './database/repositories/heartbeat-run.repository';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';

@Injectable()
export class HeartbeatRunStatusListener {
  constructor(private readonly runRepository: HeartbeatRunRepository) {}

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  async onRunStartedOrResumed(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: HeartbeatRunStatus.RUNNING,
    });
  }

  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  async onRunPaused(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: HeartbeatRunStatus.RUNNING,
    });
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: HeartbeatRunStatus.SUCCEEDED,
      finished_at: new Date(),
    });
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: HeartbeatRunStatus.FAILED,
      finished_at: new Date(),
      error_code: 'workflow_failed',
      error_message: 'Linked workflow run failed',
    });
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.applyUpdate(event.workflowRunId, {
      status: HeartbeatRunStatus.CANCELLED,
      finished_at: new Date(),
      error_code: 'workflow_cancelled',
      error_message: 'Linked workflow run was cancelled',
    });
  }

  private async applyUpdate(
    workflowRunId: string,
    update: QueryDeepPartialEntity<HeartbeatRun>,
  ): Promise<void> {
    await this.runRepository.updateByWorkflowRunId(workflowRunId, update);
  }
}
