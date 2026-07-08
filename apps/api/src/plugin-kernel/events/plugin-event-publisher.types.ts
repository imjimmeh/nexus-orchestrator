import type { WorkflowRunPluginEventPayload } from './plugin-event-envelope.types';
import type { PluginEventCandidateDeliveryResult } from './plugin-event-delivery-engine.types';

export interface PluginEventPublishResult {
  ok: boolean;
  topic: string;
  correlationId?: string;
  deliveries: PluginEventCandidateDeliveryResult[];
  errorCode?: 'event_topic_not_approved' | 'blocking_delivery_failed';
}

export interface PublishWorkflowRunLifecycleEventInput {
  runId: string;
  status: WorkflowRunPluginEventPayload['status'];
  eventName: string;
  correlationId?: string;
  occurredAt?: string;
  scopeId?: string;
  contextId?: string;
}

export interface PublishToolInvokedEventInput {
  toolName: string;
  invocationId: string;
  pluginId: string;
  contributionId: string;
  version: string;
  correlationId?: string;
  occurredAt?: string;
  scopeId?: string;
  contextId?: string;
}

export interface PublishMemoryRecordedEventInput {
  segmentId: string;
  entityType: string;
  entityId: string;
  memoryType: string;
  correlationId?: string;
  occurredAt?: string;
  scopeId?: string;
  contextId?: string;
}
