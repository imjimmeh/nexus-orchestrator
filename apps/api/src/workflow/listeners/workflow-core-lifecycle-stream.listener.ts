import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
  ExecutionContextSchema,
  isRecord,
  isTerminalWorkflowRunStatus,
} from '@nexus/core';
import type {
  CoreWorkflowRunUsageV1Shape,
  CoreWorkflowStepEventEnvelopeV1Shape,
  ExecutionContext,
} from '@nexus/core';
import { BudgetUsageEventRepository } from '../../cost-governance/database/repositories/budget-usage-event.repository';
import {
  WORKFLOW_CORE_LIFECYCLE_EVENT,
  WORKFLOW_JOB_COMPLETED_EVENT,
  WORKFLOW_JOB_FAILED_EVENT,
  WORKFLOW_JOB_QUEUED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
  WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
  WORKFLOW_RUN_STARTED_EVENT,
} from '../workflow-events.constants';
import type {
  WorkflowCoreLifecycleEvent,
  WorkflowJobEvent,
  WorkflowRunEvent,
} from '../workflow-events.types';
import { WorkflowCoreLifecycleStreamPublisher } from '../workflow-core-lifecycle-stream.publisher';

@Injectable()
export class WorkflowCoreLifecycleStreamListener {
  private readonly logger = new Logger(
    WorkflowCoreLifecycleStreamListener.name,
  );

  constructor(
    private readonly lifecycleStream: WorkflowCoreLifecycleStreamPublisher,
    private readonly usageEvents: BudgetUsageEventRepository,
  ) {}

  @OnEvent(WORKFLOW_CORE_LIFECYCLE_EVENT)
  async onCoreLifecycle(event: WorkflowCoreLifecycleEvent): Promise<void> {
    await this.lifecycleStream.publish(event.envelope);
  }

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  async onRunStarted(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.status_changed.v1');
  }

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.completed.v1');
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.status_changed.v1');
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.status_changed.v1');
  }

  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  async onRunPaused(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.status_changed.v1');
  }

  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  async onRunResumed(event: WorkflowRunEvent): Promise<void> {
    await this.publishRunEvent(event, 'core.workflow.run.status_changed.v1');
  }

  @OnEvent(WORKFLOW_JOB_QUEUED_EVENT)
  async onJobQueued(event: WorkflowJobEvent): Promise<void> {
    await this.publishStepEvent(
      event,
      'core.workflow.step.queued.v1',
      'QUEUED',
    );
  }

  @OnEvent(WORKFLOW_JOB_COMPLETED_EVENT)
  async onJobCompleted(event: WorkflowJobEvent): Promise<void> {
    await this.publishStepEvent(
      event,
      'core.workflow.step.completed.v1',
      'COMPLETED',
    );
  }

  @OnEvent(WORKFLOW_JOB_FAILED_EVENT)
  async onJobFailed(event: WorkflowJobEvent): Promise<void> {
    await this.publishStepEvent(
      event,
      'core.workflow.step.failed.v1',
      'FAILED',
    );
  }

  @OnEvent(WORKFLOW_RUN_RETRY_SCHEDULED_EVENT)
  async onRetryScheduled(event: WorkflowJobEvent): Promise<void> {
    await this.publishStepEvent(
      event,
      'core.workflow.step.retry_scheduled.v1',
      'RETRY_SCHEDULED',
    );
  }

  private async publishRunEvent(
    event: WorkflowRunEvent,
    eventType:
      | 'core.workflow.run.status_changed.v1'
      | 'core.workflow.run.completed.v1',
  ): Promise<void> {
    const occurredAt = new Date().toISOString();
    const usage = await this.resolveRunUsage(event);
    const envelope = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: eventType,
      event_version: 'v1',
      occurred_at: occurredAt,
      correlation_id: randomUUID(),
      source_service: 'core',
      payload: {
        run_id: event.workflowRunId,
        workflow_id: event.workflowId,
        status: event.status,
        context: this.readRunContext(event),
        ...(usage ? { usage } : {}),
      },
      metadata: event.reason ? { reason: event.reason } : null,
    });

    await this.lifecycleStream.publish(envelope);
  }

  /**
   * Resolves cumulative token usage for a run, but only for terminal events.
   * Attaching the total to the terminal lifecycle event lets downstream
   * consumers project per-context spend without reaching into cost tables.
   */
  private async resolveRunUsage(
    event: WorkflowRunEvent,
  ): Promise<CoreWorkflowRunUsageV1Shape | null> {
    if (!isTerminalWorkflowRunStatus(event.status)) {
      return null;
    }

    try {
      const totals = await this.usageEvents.getRunTotals(event.workflowRunId);
      if (totals.totalTokens === 0) {
        this.logger.warn(
          `No budget_usage_events found for terminal run ${event.workflowRunId} (status=${event.status}); downstream token accrual will be skipped`,
        );
      }
      const modelBreakdown = await this.usageEvents.getRunTotalsByModel(
        event.workflowRunId,
      );
      return {
        total_tokens: totals.totalTokens,
        input_tokens: totals.inputTokens,
        output_tokens: totals.outputTokens,
        estimated_cost_cents: totals.estimatedCostCents,
        priced_turn_count: totals.pricedTurnCount,
        model_breakdown:
          modelBreakdown.length > 0
            ? modelBreakdown.map((row) => ({
                model_id: row.model_id,
                provider_name: row.provider_name,
                model_name: row.model_name,
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                cost_cents: row.cost_cents,
              }))
            : null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve run usage for ${event.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async publishStepEvent(
    event: WorkflowJobEvent,
    eventType: CoreWorkflowStepEventEnvelopeV1Shape['event_type'],
    status: string,
  ): Promise<void> {
    if (!event.workflowId) {
      return;
    }

    const occurredAt = new Date().toISOString();
    const envelope = CoreWorkflowStepEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: eventType,
      event_version: 'v1',
      occurred_at: occurredAt,
      correlation_id: randomUUID(),
      source_service: 'core',
      payload: {
        run_id: event.workflowRunId,
        workflow_id: event.workflowId,
        job_id: event.jobId,
        step_id: event.jobId,
        status,
        completed_at: status === 'COMPLETED' ? occurredAt : null,
        failed_at: status === 'FAILED' ? occurredAt : null,
        retry_at: status === 'RETRY_SCHEDULED' ? occurredAt : null,
        context: this.readContext(event.payload),
        metadata: this.buildStepMetadata(event),
      },
    });

    await this.lifecycleStream.publish(envelope);
  }

  private buildStepMetadata(
    event: WorkflowJobEvent,
  ): Record<string, unknown> | null {
    const metadata: Record<string, unknown> = {};
    if (event.reason) {
      metadata.reason = event.reason;
    }
    if (event.output) {
      metadata.outputKeys = Object.keys(event.output);
    }
    if (event.payload) {
      metadata.payload = event.payload;
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private readRunContext(event: WorkflowRunEvent): ExecutionContext | null {
    const triggerFromState =
      event.stateVariables && isRecord(event.stateVariables.trigger)
        ? event.stateVariables.trigger
        : null;
    return (
      this.readContext(event.triggerData, event.stateVariables) ??
      this.parseTopLevelRunContext(event.triggerData) ??
      this.parseTopLevelRunContext(triggerFromState)
    );
  }

  private readContext(
    primary?: Record<string, unknown>,
    stateVariables?: Record<string, unknown>,
  ): ExecutionContext | null {
    const primaryContext = this.parseContext(primary?.context);
    if (primaryContext) {
      return primaryContext;
    }

    if (!stateVariables || !isRecord(stateVariables.trigger)) {
      return null;
    }
    const trigger = stateVariables.trigger;

    return this.parseContext(trigger.context);
  }

  private parseTopLevelRunContext(
    value: Record<string, unknown> | null | undefined,
  ): ExecutionContext | null {
    if (!value) {
      return null;
    }

    const context = {
      scopeId:
        this.readNullableString(value.scopeId) ??
        this.readNullableString(value.scope_id),
      contextId:
        this.readNullableString(value.contextId) ??
        this.readNullableString(value.context_id),
      contextType:
        this.readNullableString(value.contextType) ??
        this.readNullableString(value.context_type),
      metadata:
        value.metadata && typeof value.metadata === 'object'
          ? (value.metadata as Record<string, unknown>)
          : null,
    };

    if (
      !context.scopeId &&
      !context.contextId &&
      !context.contextType &&
      !context.metadata
    ) {
      return null;
    }

    const parsed = ExecutionContextSchema.safeParse(context);
    return parsed.success ? parsed.data : null;
  }

  private parseContext(value: unknown): ExecutionContext | null {
    const parsed = ExecutionContextSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    const normalized = this.normalizeSnakeCaseContext(value);
    if (!normalized) {
      return null;
    }

    const normalizedParsed = ExecutionContextSchema.safeParse(normalized);
    return normalizedParsed.success ? normalizedParsed.data : null;
  }

  private normalizeSnakeCaseContext(value: unknown): ExecutionContext | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const context = {
      scopeId: this.readNullableString(record.scope_id),
      contextId: this.readNullableString(record.context_id),
      contextType: this.readNullableString(record.context_type),
      metadata:
        record.metadata && typeof record.metadata === 'object'
          ? (record.metadata as Record<string, unknown>)
          : null,
    };

    const parsed = ExecutionContextSchema.safeParse(context);
    return parsed.success ? parsed.data : null;
  }

  private readNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }
}
