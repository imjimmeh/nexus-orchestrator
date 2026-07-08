import { Injectable } from '@nestjs/common';
import { RedisStreamService } from '../../redis/redis-stream.service';
import { RedisPubSubService } from '../../redis/redis-pubsub.service';

export type { WorkflowEventPayload } from './step-event-publisher.service.types';
import type { WorkflowEventPayload } from './step-event-publisher.service.types';

@Injectable()
export class StepEventPublisherService {
  constructor(
    private readonly streamService: RedisStreamService,
    private readonly pubsubService: RedisPubSubService,
  ) {}

  createEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): WorkflowEventPayload {
    return {
      event_type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    };
  }

  async publishBestEffort(
    workflowRunId: string,
    event: WorkflowEventPayload,
  ): Promise<void> {
    try {
      await this.streamService.persistEvent(workflowRunId, event);
    } catch {
      // best-effort stream persistence
    }

    try {
      await this.pubsubService.publishEvent(workflowRunId, event);
    } catch {
      // best-effort pubsub publishing
    }
  }

  async publishProcessEvent(
    workflowRunId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.publishBestEffort(
      workflowRunId,
      this.createEvent(eventType, payload),
    );
  }

  async publishBashOutput(
    workflowRunId: string,
    jobId: string,
    containerId: string,
    stream: 'stdout' | 'stderr',
    chunk: string,
    stepId?: string,
  ): Promise<void> {
    if (!chunk) {
      return;
    }

    const payload: Record<string, unknown> = {
      workflowRunId,
      jobId,
      containerId,
      stream,
      chunk,
    };

    if (stepId) {
      payload.stepId = stepId;
    }

    await this.publishBestEffort(
      workflowRunId,
      this.createEvent('bash_output', payload),
    );
  }
}
