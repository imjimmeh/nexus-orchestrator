import { Injectable, Logger } from '@nestjs/common';
import type { ImprovementTaskRequestedEventEnvelopeV1Shape } from '@nexus/core';
import { RedisStreamService } from '../redis/redis-stream.service';
import { CORE_LIFECYCLE_STREAM_KEY } from '../workflow/workflow-core-lifecycle-stream.publisher';

const IMPROVEMENT_TASK_STREAM_MAX_LENGTH = 100000;

/**
 * Publishes neutral improvement-task-requested events onto the core
 * lifecycle stream. Mirrors `WorkflowCoreLifecycleStreamPublisher`;
 * downstream stream consumers decide how — and whether — to route the
 * brief. The publisher itself stays domain-neutral.
 */
@Injectable()
export class ImprovementTaskEventPublisher {
  private readonly logger = new Logger(ImprovementTaskEventPublisher.name);

  constructor(private readonly stream: RedisStreamService) {}

  async publish(
    envelope: ImprovementTaskRequestedEventEnvelopeV1Shape,
  ): Promise<string> {
    try {
      const streamId = await this.stream.appendToStream(
        CORE_LIFECYCLE_STREAM_KEY,
        {
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          occurred_at: envelope.occurred_at,
          envelope: JSON.stringify(envelope),
        },
        { maxLength: IMPROVEMENT_TASK_STREAM_MAX_LENGTH },
      );
      if (!streamId) {
        throw new Error('Redis did not return a stream id');
      }

      return streamId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to publish improvement task event ${envelope.event_id}: ${message}`,
      );
      throw error;
    }
  }
}
