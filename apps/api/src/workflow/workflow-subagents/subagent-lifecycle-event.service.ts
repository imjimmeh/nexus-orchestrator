import { Injectable } from '@nestjs/common';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RedisPubSubService } from '../../redis/redis-pubsub.service';
import type { SubagentLifecycleEventParams } from './subagent-orchestrator.operations.types';

/**
 * Owns subagent lifecycle event emission to the event ledger and real-time
 * broadcast to the telemetry channel.
 */
@Injectable()
export class SubagentLifecycleEventService {
  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly pubsub: RedisPubSubService,
  ) {}

  async emit(params: SubagentLifecycleEventParams): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (params.payload) {
      Object.assign(payload, params.payload);
    }
    if (params.parentContainerId) {
      payload.parent_container_id = params.parentContainerId;
    }
    if (params.subagentExecutionId) {
      payload.subagentExecutionId = params.subagentExecutionId;
    }

    await this.eventLedger.emitBestEffort({
      domain: 'subagent',
      eventName: params.eventName,
      outcome: params.outcome,
      actorType: 'system',
      workflowRunId: params.workflowRunId,
      subagentExecutionId: params.subagentExecutionId,
      payload,
      errorMessage: params.error
        ? this.resolveErrorMessage(params.error)
        : undefined,
    });

    if (params.workflowRunId) {
      await this.pubsub.publishEvent(params.workflowRunId, {
        event_type: params.eventName,
        timestamp: new Date().toISOString(),
        payload: {
          ...payload,
          domain: 'subagent',
          outcome: params.outcome,
          subagentExecutionId: params.subagentExecutionId,
        },
      });
    }
  }

  resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
