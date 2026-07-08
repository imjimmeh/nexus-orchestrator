import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
  WORKFLOW_JOB_QUEUED_EVENT,
  WORKFLOW_JOB_COMPLETED_EVENT,
  WORKFLOW_JOB_FAILED_EVENT,
  WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
  WORKFLOW_CORE_LIFECYCLE_EVENT,
  WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT,
} from '../workflow-events.constants';
import type {
  WorkflowRunEvent,
  WorkflowJobEvent,
  WorkflowCoreLifecycleEvent,
} from '../workflow-events.types';

/**
 * Subscribes to all canonical `workflow.*` and `job.*` bus events and
 * persists them to the event ledger via `WorkflowEventLogService`.
 *
 * This listener is the single point of responsibility for audit logging
 * of workflow lifecycle transitions, replacing the direct
 * `WorkflowEventLogService.appendBestEffort()` calls that were previously
 * scattered across `WorkflowEngineService` and `WorkflowRunJobExecutionService`.
 */
@Injectable()
export class WorkflowAuditListener {
  constructor(private readonly eventLog: WorkflowEventLogService) {}

  // ── Run-level events ───────────────────────────────────────────────────────

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  async onRunStarted(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.started',
      payload: {
        workflowId: event.workflowId,
        triggerData: event.triggerData,
      },
    });
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.completed',
    });
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.failed',
      payload: { reason: event.reason },
    });
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.cancelled',
      payload: { reason: event.reason },
    });
  }

  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  async onRunPaused(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.paused',
    });
  }

  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  async onRunResumed(event: WorkflowRunEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.resumed',
    });
  }

  // ── Job-level events ───────────────────────────────────────────────────────

  @OnEvent(WORKFLOW_JOB_QUEUED_EVENT)
  async onJobQueued(event: WorkflowJobEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'job.queued',
      jobId: event.jobId,
      payload: event.payload,
    });
  }

  @OnEvent(WORKFLOW_JOB_COMPLETED_EVENT)
  async onJobCompleted(event: WorkflowJobEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'job.completed',
      jobId: event.jobId,
      payload: event.payload,
    });
  }

  @OnEvent(WORKFLOW_JOB_FAILED_EVENT)
  async onJobFailed(event: WorkflowJobEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'job.failed',
      jobId: event.jobId,
      payload: { reason: event.reason },
    });
  }

  @OnEvent(WORKFLOW_RUN_RETRY_SCHEDULED_EVENT)
  async onRetryScheduled(event: WorkflowJobEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.retry_scheduled',
      jobId: event.jobId,
      payload: event.payload,
      outcome: 'in_progress',
      severity: 'warn',
    });
  }

  // ── Core lifecycle envelope events ────────────────────────────────────────

  @OnEvent(WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT)
  async onActivatedFromQueue(event: { workflowRunId: string }): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.activated_from_queue',
    });
  }

  // ── Core lifecycle envelope events ────────────────────────────────────────

  @OnEvent(WORKFLOW_CORE_LIFECYCLE_EVENT)
  async onCoreLifecycle(event: WorkflowCoreLifecycleEvent): Promise<void> {
    const envelope = event.envelope as unknown as Record<string, unknown>;
    const eventType =
      typeof envelope.eventType === 'string'
        ? envelope.eventType
        : event.envelope.event_type;

    await this.eventLog.appendBestEffort({
      workflowRunId: event.runId,
      eventType,
      payload: envelope,
    });
  }
}
