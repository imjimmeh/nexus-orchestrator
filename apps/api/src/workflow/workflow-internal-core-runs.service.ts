import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BadRequestException,
  ConflictException,
  Logger,
  Injectable,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ExecutionContextSchema,
  CoreWorkflowRunEventEnvelopeV1Schema,
  WorkflowRunAcceptedV1Schema,
  WorkflowRunControlResultV1Schema,
  WorkflowRunControlRequestV1Schema,
  WorkflowRunMetadataV1Schema,
  WorkflowRunRequestV1Schema,
  WorkflowRunScopeCancelRequestV1Schema,
  WorkflowRunScopeCancelResultV1Schema,
  WorkflowRunStatusV1Schema,
  normalizeOptionalString,
} from '@nexus/core';
import type {
  CoreWorkflowEventTypeV1,
  CoreWorkflowRunEventPayloadV1,
  WorkflowRunAcceptedV1,
  WorkflowRunControlRequestV1,
  WorkflowRunControlResultV1,
  WorkflowRunScopeCancelRequestV1,
  WorkflowRunScopeCancelResultV1,
  WorkflowRunRequestV1,
  WorkflowRunStatusV1,
} from '@nexus/core';
import { WorkflowRunSteeringService } from './workflow-run-operations/workflow-run-steering.service';
import { WORKFLOW_CORE_LIFECYCLE_EVENT } from './workflow-events.constants';
import type { WorkflowCoreLifecycleEvent } from './workflow-events.types';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from './kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
} from './kernel/interfaces/workflow-kernel.ports';

type ActiveWorkflowRun = { id: string };
type ParsedWorkflowRunRequest = z.infer<typeof WorkflowRunRequestV1Schema>;
type ParsedWorkflowRunControlRequest = z.infer<
  typeof WorkflowRunControlRequestV1Schema
>;
type ParsedWorkflowRunMetadata = z.infer<typeof WorkflowRunMetadataV1Schema>;
type ParsedWorkflowRunContext = z.infer<typeof ExecutionContextSchema>;

@Injectable()
export class WorkflowInternalCoreRunsService {
  private readonly logger = new Logger(WorkflowInternalCoreRunsService.name);

  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly workflowRunSteering: WorkflowRunSteeringService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1> {
    const parsedRequest: ParsedWorkflowRunRequest =
      WorkflowRunRequestV1Schema.parse(request);
    const metadata = this.normalizeMetadata(parsedRequest.metadata);
    const acceptedAt = new Date().toISOString();

    const runId = await this.workflowEngine.startWorkflow(
      parsedRequest.workflow_id,
      this.buildRunInput(parsedRequest),
    );
    if (!runId) {
      throw new ConflictException(
        `Workflow ${parsedRequest.workflow_id} start request was skipped by concurrency policy`,
      );
    }

    const run = await this.workflowPersistence.getWorkflowRun(runId);

    const accepted = WorkflowRunAcceptedV1Schema.parse({
      run_id: runId,
      workflow_id: parsedRequest.workflow_id,
      status: 'accepted',
      accepted_at: acceptedAt,
      metadata,
    });

    this.emitCoreLifecycleEvent({
      eventType: 'core.workflow.run.requested.v1',
      run_id: runId,
      workflow_id: parsedRequest.workflow_id,
      status: 'REQUESTED',
      context: parsedRequest.context ?? null,
      metadata,
    });

    this.emitCoreLifecycleEvent({
      eventType: 'core.workflow.run.accepted.v1',
      run_id: runId,
      workflow_id: parsedRequest.workflow_id,
      status: run.status,
      context: parsedRequest.context ?? null,
      metadata,
    });

    return accepted;
  }

  private buildRunInput(
    request: WorkflowRunRequestV1,
  ): Record<string, unknown> {
    const input = request.input ?? {};
    const additions: Record<string, unknown> = {};

    const idempotencyKey = normalizeOptionalString(
      request.metadata?.idempotency_key,
    );
    if (idempotencyKey && !this.hasInputField(input, 'dedupeKey')) {
      additions.dedupeKey = idempotencyKey;
    }

    if (request.context && !this.hasInputField(input, 'context')) {
      additions.context = request.context;
    }

    if (
      !request.external_mcp_mounts ||
      request.external_mcp_mounts.length === 0
    ) {
      return Object.keys(additions).length > 0
        ? { ...input, ...additions }
        : input;
    }
    return {
      ...input,
      ...additions,
      external_mcp_mounts: request.external_mcp_mounts,
    };
  }

  private hasInputField(
    input: Record<string, unknown>,
    field: string,
  ): boolean {
    return Object.prototype.hasOwnProperty.call(input, field);
  }

  async getWorkflowRunStatus(runId: string): Promise<WorkflowRunStatusV1> {
    const run = await this.workflowPersistence.getWorkflowRun(runId);
    const metadata = this.normalizeMetadata({
      correlation_id: randomUUID(),
      requested_by: 'internal_core_api',
    });

    return WorkflowRunStatusV1Schema.parse({
      run_id: run.id,
      workflow_id: run.workflow_id,
      status: run.status,
      current_step_id: run.current_step_id ?? null,
      updated_at: run.updated_at.toISOString(),
      metadata,
    });
  }

  async controlWorkflowRun(
    pathRunId: string,
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1> {
    const controlRequest: ParsedWorkflowRunControlRequest =
      WorkflowRunControlRequestV1Schema.parse(request);
    if (controlRequest.run_id !== pathRunId) {
      throw new BadRequestException(
        `run_id mismatch between path (${pathRunId}) and body (${controlRequest.run_id})`,
      );
    }

    switch (controlRequest.action) {
      case 'pause':
        await this.workflowRunSteering.pause(pathRunId);
        break;
      case 'resume':
        await this.workflowRunSteering.resume(pathRunId);
        break;
      case 'abort':
        await this.workflowRunSteering.abort(pathRunId, controlRequest.reason);
        break;
      default:
        throw new BadRequestException(
          `Unsupported control action ${(controlRequest as { action?: unknown }).action as string}`,
        );
    }

    const run = await this.workflowPersistence.getWorkflowRun(pathRunId);
    const result = WorkflowRunControlResultV1Schema.parse({
      run_id: pathRunId,
      action: controlRequest.action,
      accepted: true,
      status: run.status,
      updated_at: run.updated_at.toISOString(),
      metadata: this.normalizeMetadata(controlRequest.metadata),
      message: controlRequest.reason,
    });

    this.emitCoreLifecycleEvent({
      eventType: 'core.workflow.run.status_changed.v1',
      run_id: run.id,
      workflow_id: run.workflow_id,
      status: run.status,
      context: this.readTriggerContext(run.state_variables),
      metadata: this.normalizeMetadata(controlRequest.metadata),
    });

    return result;
  }

  async cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1> {
    const parsedRequest = WorkflowRunScopeCancelRequestV1Schema.parse(request);
    const metadata = this.normalizeMetadata(parsedRequest.metadata);

    const activeRuns: ActiveWorkflowRun[] =
      await this.workflowPersistence.getActiveWorkflowRunsByScopeId(scopeId);

    const requestedRuns = activeRuns.length;
    let skippedRuns = 0;
    const cancelledRunIds: string[] = [];

    for (const run of activeRuns) {
      try {
        await this.workflowRunSteering.abort(
          run.id,
          parsedRequest.reason ?? 'project_deleted',
        );
        cancelledRunIds.push(run.id);
      } catch (error) {
        skippedRuns += 1;
        const message = this.formatErrorMessage(error);
        this.logger.warn(
          `Failed to cancel workflow run ${run.id} for scope ${scopeId}: ${message}`,
        );
      }
    }

    return WorkflowRunScopeCancelResultV1Schema.parse({
      scope_id: scopeId,
      requested_runs: requestedRuns,
      cancelled_runs: cancelledRunIds.length,
      skipped_runs: skippedRuns,
      cancelled_run_ids: cancelledRunIds,
      reason: parsedRequest.reason,
      metadata,
    });
  }

  private normalizeMetadata(
    metadata: Partial<ParsedWorkflowRunMetadata> | null | undefined,
  ): ParsedWorkflowRunMetadata {
    return WorkflowRunMetadataV1Schema.parse({
      correlation_id: this.requireCorrelationId(metadata?.correlation_id),
      causation_id: normalizeOptionalString(metadata?.causation_id),
      idempotency_key: normalizeOptionalString(metadata?.idempotency_key),
      requested_by: normalizeOptionalString(metadata?.requested_by),
    });
  }

  private requireCorrelationId(value: string | undefined): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return randomUUID();
  }

  private emitCoreLifecycleEvent(params: {
    eventType: CoreWorkflowEventTypeV1;
    run_id: string;
    workflow_id: string;
    status: string;
    context?: CoreWorkflowRunEventPayloadV1['context'];
    metadata: ParsedWorkflowRunMetadata;
  }): void {
    const payload: CoreWorkflowRunEventPayloadV1 = {
      run_id: params.run_id,
      workflow_id: params.workflow_id,
      status: params.status,
      context: params.context ?? null,
    };

    const envelope = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: params.eventType,
      event_version: 'v1',
      occurred_at: new Date().toISOString(),
      correlation_id: params.metadata.correlation_id,
      causation_id: params.metadata.causation_id ?? null,
      source_service: 'core',
      payload,
      metadata: {
        requested_by: params.metadata.requested_by ?? null,
        idempotency_key: params.metadata.idempotency_key ?? null,
      },
    });

    const lifecycleEvent: WorkflowCoreLifecycleEvent = {
      runId: params.run_id,
      workflowId: params.workflow_id,
      envelope,
    };
    this.eventEmitter.emit(WORKFLOW_CORE_LIFECYCLE_EVENT, lifecycleEvent);
  }

  private readTriggerContext(
    stateVariables: unknown,
  ): CoreWorkflowRunEventPayloadV1['context'] {
    if (!stateVariables || typeof stateVariables !== 'object') {
      return null;
    }

    const trigger = (stateVariables as Record<string, unknown>).trigger;
    if (!trigger || typeof trigger !== 'object') {
      return null;
    }

    return this.parseWorkflowRunContext(
      (trigger as Record<string, unknown>).context,
    );
  }

  private parseWorkflowRunContext(
    value: unknown,
  ): ParsedWorkflowRunContext | null {
    const parsed = ExecutionContextSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
