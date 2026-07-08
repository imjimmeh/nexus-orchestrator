import { Injectable } from '@nestjs/common';
import {
  isApprovedTopicForPlugin,
  isPluginNamespaceTopic,
} from './plugin-event-topic-catalog';
import type {
  MemoryRecordedPluginEventPayload,
  PluginEventEnvelope,
  ToolInvokedPluginEventPayload,
  WorkflowRunPluginEventPayload,
} from './plugin-event-envelope.types';
import { PluginEventDeliveryEngineService } from './plugin-event-delivery-engine.service';
import type {
  PluginEventPublishResult,
  PublishMemoryRecordedEventInput,
  PublishToolInvokedEventInput,
  PublishWorkflowRunLifecycleEventInput,
} from './plugin-event-publisher.types';

@Injectable()
export class PluginEventPublisherService {
  constructor(
    private readonly deliveryEngine: PluginEventDeliveryEngineService,
  ) {}

  async publish(
    envelope: PluginEventEnvelope,
    options: { publisherPluginId?: string } = {},
  ): Promise<PluginEventPublishResult> {
    const publisherPluginId = options.publisherPluginId;
    const topicApproved = isApprovedTopicForPlugin(
      envelope.topic,
      publisherPluginId,
    );

    if (!topicApproved) {
      return {
        ok: false,
        topic: envelope.topic,
        correlationId: envelope.correlationId,
        deliveries: [],
        errorCode: 'event_topic_not_approved',
      };
    }

    if (isPluginNamespaceTopic(envelope.topic) && !publisherPluginId) {
      return {
        ok: false,
        topic: envelope.topic,
        correlationId: envelope.correlationId,
        deliveries: [],
        errorCode: 'event_topic_not_approved',
      };
    }

    const delivery = await this.deliveryEngine.deliver(envelope);
    if (!delivery.ok) {
      return {
        ok: false,
        topic: envelope.topic,
        correlationId: envelope.correlationId,
        deliveries: delivery.deliveries,
        errorCode: 'blocking_delivery_failed',
      };
    }

    return {
      ok: true,
      topic: envelope.topic,
      correlationId: envelope.correlationId,
      deliveries: delivery.deliveries,
    };
  }

  async publishWorkflowRunLifecycleEvent(
    input: PublishWorkflowRunLifecycleEventInput,
  ): Promise<PluginEventPublishResult> {
    const topic = `workflow.run.${input.status}.v1`;
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const payload: Record<string, unknown> &
      WorkflowRunPluginEventPayload & {
        eventName: string;
        correlationId?: string;
      } = {
      runId: input.runId,
      status: input.status,
      timestamp: occurredAt,
      scopeId: input.scopeId,
      contextId: input.contextId,
      eventName: input.eventName,
      correlationId: input.correlationId,
    };

    return this.publish({
      topic,
      eventName: topic,
      occurredAt,
      correlationId: input.correlationId,
      payload,
      scopeId: input.scopeId,
      contextId: input.contextId,
    });
  }

  async publishToolInvokedEvent(
    input: PublishToolInvokedEventInput,
  ): Promise<PluginEventPublishResult> {
    const topic = 'tool.invoked.v1';
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const payload: Record<string, unknown> &
      ToolInvokedPluginEventPayload & {
        pluginId: string;
        contributionId: string;
        version: string;
        correlationId?: string;
      } = {
      toolName: input.toolName,
      invocationId: input.invocationId,
      timestamp: occurredAt,
      scopeId: input.scopeId,
      contextId: input.contextId,
      pluginId: input.pluginId,
      contributionId: input.contributionId,
      version: input.version,
      correlationId: input.correlationId,
    };

    return this.publish({
      topic,
      eventName: topic,
      occurredAt,
      correlationId: input.correlationId,
      payload,
      scopeId: input.scopeId,
      contextId: input.contextId,
    });
  }

  async publishMemoryRecordedEvent(
    input: PublishMemoryRecordedEventInput,
  ): Promise<PluginEventPublishResult> {
    const topic = 'memory.recorded.v1';
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const payload: Record<string, unknown> &
      MemoryRecordedPluginEventPayload & {
        entityType: string;
        entityId: string;
        memoryType: string;
        correlationId?: string;
      } = {
      segmentId: input.segmentId,
      timestamp: occurredAt,
      scopeId: input.scopeId,
      contextId: input.contextId,
      entityType: input.entityType,
      entityId: input.entityId,
      memoryType: input.memoryType,
      correlationId: input.correlationId,
    };

    return this.publish({
      topic,
      eventName: topic,
      occurredAt,
      correlationId: input.correlationId,
      payload,
      scopeId: input.scopeId,
      contextId: input.contextId,
    });
  }
}
