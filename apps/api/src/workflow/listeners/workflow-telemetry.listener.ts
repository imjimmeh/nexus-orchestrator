import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { MetricsService } from '../../observability/metrics.service';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';

/**
 * Subscribes to canonical `workflow.run.*` events and updates Prometheus
 * metrics via `MetricsService`.
 *
 * Tracking logic:
 * - `workflow.run.started` → increment `workflowsActive` and `workflowExecutionsTotal`
 * - `workflow.run.completed` / `workflow.run.failed` / `workflow.run.cancelled`
 *   → decrement `workflowsActive` and increment `workflowExecutionsTotal` with
 *     the final status label.
 */
@Injectable()
export class WorkflowTelemetryListener {
  constructor(private readonly metrics: MetricsService) {}

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  onRunStarted(event: WorkflowRunEvent): void {
    this.metrics.workflowsActive.inc({ workflow_id: event.workflowId });
    this.metrics.workflowExecutionsTotal.inc({
      workflow_id: event.workflowId,
      status: WorkflowStatus.RUNNING,
    });
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  onRunCompleted(event: WorkflowRunEvent): void {
    this.metrics.workflowsActive.dec({ workflow_id: event.workflowId });
    this.metrics.workflowExecutionsTotal.inc({
      workflow_id: event.workflowId,
      status: WorkflowStatus.COMPLETED,
    });
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  onRunFailed(event: WorkflowRunEvent): void {
    this.metrics.workflowsActive.dec({ workflow_id: event.workflowId });
    this.metrics.workflowExecutionsTotal.inc({
      workflow_id: event.workflowId,
      status: WorkflowStatus.FAILED,
    });
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  onRunCancelled(event: WorkflowRunEvent): void {
    this.metrics.workflowsActive.dec({ workflow_id: event.workflowId });
    this.metrics.workflowExecutionsTotal.inc({
      workflow_id: event.workflowId,
      status: WorkflowStatus.CANCELLED,
    });
  }
}
