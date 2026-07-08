import { Injectable, Logger } from '@nestjs/common';
import { WorkflowEvent } from '../workflow/database/entities/workflow-event.entity';
import { WorkflowEventRepository } from '../workflow/database/repositories/workflow-event.repository';
import { RequestContextService } from '../common/request-context.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { WarRoomAppendEventParams } from './ports/event-log.types';

@Injectable()
export class WarRoomWorkflowEventLogService {
  private readonly logger = new Logger(WarRoomWorkflowEventLogService.name);

  constructor(
    private readonly repository: WorkflowEventRepository,
    private readonly requestContext: RequestContextService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async appendBestEffort(params: WarRoomAppendEventParams): Promise<void> {
    try {
      await this.append(params);
    } catch {
      // best-effort - failure already logged in append()
    }
  }

  private async append(
    params: WarRoomAppendEventParams,
  ): Promise<WorkflowEvent> {
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
        outcome: this.resolveOutcomeFromEventType(params.eventType),
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
}
