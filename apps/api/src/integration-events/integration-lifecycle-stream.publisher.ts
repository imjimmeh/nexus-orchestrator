import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  type CoreIntegrationPrMergedV1,
  type CoreIntegrationPrStatusV1,
} from '@nexus/core';
import { RedisStreamService } from '../redis/redis-stream.service';

const CORE_LIFECYCLE_STREAM_KEY = 'stream:core:lifecycle';
const CORE_LIFECYCLE_STREAM_MAX_LENGTH = 100000;

/**
 * Publishes neutral `core.integration.*` lifecycle events onto the shared
 * `stream:core:lifecycle`. Distinct from the workflow run/step publisher because
 * these events have no run_id/workflow_id — only neutral scope/context.
 */
@Injectable()
export class IntegrationLifecycleStreamPublisher {
  constructor(private readonly stream: RedisStreamService) {}

  async publishPrMerged(payload: CoreIntegrationPrMergedV1): Promise<string> {
    const envelope = CoreIntegrationPrMergedEventEnvelopeV1Schema.parse(
      this.buildEnvelope('core.integration.pr_merged.v1', payload),
    );
    return this.append(envelope);
  }

  async publishPrStatus(payload: CoreIntegrationPrStatusV1): Promise<string> {
    const envelope = CoreIntegrationPrStatusEventEnvelopeV1Schema.parse(
      this.buildEnvelope('core.integration.pr_status.v1', payload),
    );
    return this.append(envelope);
  }

  private buildEnvelope(
    eventType:
      | 'core.integration.pr_merged.v1'
      | 'core.integration.pr_status.v1',
    payload: CoreIntegrationPrMergedV1 | CoreIntegrationPrStatusV1,
  ): Record<string, unknown> {
    return {
      event_id: randomUUID(),
      event_type: eventType,
      event_version: 'v1',
      occurred_at: new Date().toISOString(),
      correlation_id: randomUUID(),
      source_service: 'core',
      payload,
      metadata: null,
    };
  }

  private async append(envelope: {
    event_id: string;
    event_type: string;
    occurred_at: string;
  }): Promise<string> {
    const streamId = await this.stream.appendToStream(
      CORE_LIFECYCLE_STREAM_KEY,
      {
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        occurred_at: envelope.occurred_at,
        envelope: JSON.stringify(envelope),
      },
      { maxLength: CORE_LIFECYCLE_STREAM_MAX_LENGTH },
    );
    if (!streamId) {
      throw new Error('Redis did not return a stream id');
    }
    return streamId;
  }
}
