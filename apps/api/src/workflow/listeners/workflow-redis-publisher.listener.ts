import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';

/**
 * Subscribes to canonical `workflow.run.*` events and publishes them to the
 * Redis stream / pub-sub bus so that the web UI stays in sync with the
 * run lifecycle in real time.
 *
 * This replaces the ad-hoc calls to `StepEventPublisherService` that were
 * previously inlined in the engine services.
 */
@Injectable()
export class WorkflowRedisPublisherListener {
  constructor(private readonly eventPublisher: StepEventPublisherService) {}

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  async onRunStarted(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.started', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
      }),
    );
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.completed', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
      }),
    );
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.failed', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
        reason: event.reason,
      }),
    );
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.cancelled', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
        reason: event.reason,
      }),
    );
  }

  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  async onRunPaused(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.paused', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
      }),
    );
  }

  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  async onRunResumed(event: WorkflowRunEvent): Promise<void> {
    await this.eventPublisher.publishBestEffort(
      event.workflowRunId,
      this.eventPublisher.createEvent('workflow.run.resumed', {
        workflowRunId: event.workflowRunId,
        workflowId: event.workflowId,
        status: event.status,
      }),
    );
  }
}
