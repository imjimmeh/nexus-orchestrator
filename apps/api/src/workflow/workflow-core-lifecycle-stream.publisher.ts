import { Injectable, Logger } from '@nestjs/common';
import type { CoreWorkflowEventEnvelopeV1Shape } from '@nexus/core';
import { RedisStreamService } from '../redis/redis-stream.service';

export const CORE_LIFECYCLE_STREAM_KEY = 'stream:core:lifecycle';
const CORE_LIFECYCLE_STREAM_MAX_LENGTH = 100000;

@Injectable()
export class WorkflowCoreLifecycleStreamPublisher {
  private readonly logger = new Logger(
    WorkflowCoreLifecycleStreamPublisher.name,
  );

  constructor(private readonly stream: RedisStreamService) {}

  async publish(envelope: CoreWorkflowEventEnvelopeV1Shape): Promise<string> {
    try {
      const streamId = await this.stream.appendToStream(
        CORE_LIFECYCLE_STREAM_KEY,
        {
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          run_id: envelope.payload.run_id,
          workflow_id: envelope.payload.workflow_id,
          occurred_at: envelope.occurred_at,
          envelope: JSON.stringify(envelope),
        },
        { maxLength: CORE_LIFECYCLE_STREAM_MAX_LENGTH },
      );
      if (!streamId) {
        throw new Error('Redis did not return a stream id');
      }

      return streamId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to publish core lifecycle event ${envelope.event_id}: ${message}`,
      );
      throw error;
    }
  }
}
