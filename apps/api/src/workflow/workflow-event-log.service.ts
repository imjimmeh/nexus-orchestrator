import { Injectable, Logger } from '@nestjs/common';
import { WorkflowEventRepository } from './database/repositories/workflow-event.repository';
import { WorkflowEvent } from './database/entities/workflow-event.entity';
import { RequestContextService } from '../common/request-context.service';
import { EventLedgerService } from '../observability/event-ledger.service';

export type { AppendEventParams } from './workflow-event-log.service.types';
import type { AppendEventParams } from './workflow-event-log.service.types';
import type {
  WorkflowEventPageFilters,
  WorkflowRunRequiredToolsAuditSummary,
} from './database/repositories/workflow-event.repository.types';

@Injectable()
export class WorkflowEventLogService {
  private readonly logger = new Logger(WorkflowEventLogService.name);

  constructor(
    private readonly repository: WorkflowEventRepository,
    private readonly requestContext: RequestContextService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async append(params: AppendEventParams): Promise<WorkflowEvent> {
    const correlationId = this.requestContext.getRequestId();

    try {
      const event = await this.repository.append({
        workflow_run_id: params.workflowRunId,
        event_type: params.eventType,
        step_id: params.stepId,
        job_id: params.jobId,
        actor_id: params.actorId,
        correlation_id: correlationId,
        payload: params.payload,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'workflow',
        eventName: params.eventType,
        outcome:
          params.outcome ?? this.resolveOutcomeFromEventType(params.eventType),
        severity: params.severity,
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        stepId: params.stepId,
        actorId: params.actorId,
        correlationId,
        payload: params.payload,
      });

      return event;
    } catch (error) {
      this.logger.error(
        `Failed to append workflow event [${params.eventType}] for run ${params.workflowRunId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async appendBestEffort(params: AppendEventParams): Promise<void> {
    try {
      await this.append(params);
    } catch {
      // best-effort — failure already logged in append()
    }
  }

  private resolveOutcomeFromEventType(
    eventType: string,
  ): 'success' | 'failure' | 'denied' | 'in_progress' {
    const lowered = eventType.toLowerCase();
    if (lowered.includes('failed') || lowered.includes('error')) {
      return 'failure';
    }

    if (lowered.includes('denied')) {
      return 'denied';
    }

    if (lowered.includes('started') || lowered.includes('queued')) {
      return 'in_progress';
    }

    return 'success';
  }

  async getHistory(
    workflowRunId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ events: WorkflowEvent[]; total: number }> {
    const [events, total] = await this.repository.findByRunId(
      workflowRunId,
      limit,
      offset,
    );
    return { events, total };
  }

  async getPagedHistory(
    pagination: { limit: number; offset: number },
    filters?: WorkflowEventPageFilters,
  ): Promise<{ events: WorkflowEvent[]; total: number }> {
    const [events, total] = await this.repository.findPaged(pagination, {
      scopeId: filters?.scopeId,
      search: filters?.search,
      sortBy: filters?.sortBy,
      sortDir: filters?.sortDir,
    });
    return { events, total };
  }

  async getRequiredToolsAuditSummary(
    workflowRunId: string,
  ): Promise<WorkflowRunRequiredToolsAuditSummary | null> {
    return this.repository.getRequiredToolsAuditSummaryByRunId(workflowRunId);
  }
}
