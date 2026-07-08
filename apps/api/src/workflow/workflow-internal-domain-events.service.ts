import { Injectable, Optional } from '@nestjs/common';
import {
  isRecord,
  readString,
  type ChatEventEnvelopeV1Shape,
  type ExecutionContext,
} from '@nexus/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { DomainEventBus } from '../domain-events/domain-event-bus.types';
import { PluginEventPublisherService } from '../plugin-kernel/events/plugin-event-publisher.service';

type DomainEventInput = Record<string, unknown> & {
  payload?: unknown;
};

function readStringField(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readDateField(
  source: Record<string, unknown>,
  ...keys: string[]
): Date | undefined {
  const value = readStringField(source, ...keys);
  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildLedgerContext(
  payload: Record<string, unknown>,
): ExecutionContext | undefined {
  const scopeId = typeof payload.scopeId === 'string' ? payload.scopeId : null;
  const contextId =
    typeof payload.contextId === 'string' ? payload.contextId : null;

  if (scopeId === null && contextId === null) {
    return undefined;
  }

  return {
    scopeId,
    contextId,
    contextType: contextId === null ? null : 'resource',
    scopeNodeId: null,
    scopePath: null,
  };
}

function attachNonEnumerableStringField(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true,
  });
}

type WorkflowLifecycleStatus = 'started' | 'completed' | 'failed';

function toWorkflowLifecycleStatus(
  domain: string,
  eventName: string,
): WorkflowLifecycleStatus | null {
  if (domain !== 'workflow') {
    return null;
  }

  const normalized = eventName.toLowerCase();
  if (
    normalized === 'workflow.run.started.v1' ||
    normalized === 'workflow.run.started'
  ) {
    return 'started';
  }

  if (
    normalized === 'workflow.run.completed.v1' ||
    normalized === 'workflow.run.completed'
  ) {
    return 'completed';
  }

  if (
    normalized === 'workflow.run.failed.v1' ||
    normalized === 'workflow.run.failed'
  ) {
    return 'failed';
  }

  return null;
}

@Injectable()
export class WorkflowInternalDomainEventsService {
  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly domainEventBus?: DomainEventBus,
    @Optional()
    private readonly pluginEventPublisher?: PluginEventPublisherService,
  ) {}

  async ingestDomainEvent(
    domain: string,
    event: DomainEventInput,
  ): Promise<void> {
    const payload = isRecord(event.payload) ? event.payload : {};
    const eventName =
      readStringField(
        event,
        'event_type',
        'eventType',
        'event_name',
        'eventName',
      ) ?? 'unknown';
    const source =
      readStringField(event, 'source_service', 'sourceService') ?? domain;
    const correlationId = readStringField(
      event,
      'correlation_id',
      'correlationId',
    );
    const occurredAt = readDateField(event, 'occurred_at', 'occurredAt');

    const payloadWithEvent = {
      ...payload,
      event: eventName,
      scopeId: payload.scopeId,
      contextId: payload.contextId,
    };
    attachNonEnumerableStringField(
      payloadWithEvent,
      'eventId',
      readStringField(event, 'event_id', 'eventId'),
    );

    await this.eventLedger.emitBestEffort({
      domain,
      eventName,
      outcome: 'success',
      source,
      correlationId,
      requestId: correlationId,
      context: buildLedgerContext(payload),
      payload: event,
    });

    await this.domainEventBus?.publish({
      eventId:
        readStringField(event, 'event_id', 'eventId') ??
        `${domain}:${eventName}:${Date.now()}`,
      eventType: eventName,
      aggregateId: readStringField(payload, 'contextId', 'scopeId') ?? domain,
      aggregateType: domain,
      payload: payloadWithEvent,
      correlationId,
      occurredAt: occurredAt ?? new Date(),
    });

    const workflowStatus = toWorkflowLifecycleStatus(domain, eventName);
    const workflowRunId = readStringField(payload, 'runId', 'run_id');
    if (workflowStatus && workflowRunId) {
      await this.publishWorkflowLifecycleBestEffort({
        runId: workflowRunId,
        status: workflowStatus,
        eventName,
        correlationId,
        occurredAt: (occurredAt ?? new Date()).toISOString(),
        scopeId: readStringField(payload, 'scopeId', 'scope_id'),
        contextId: readStringField(payload, 'contextId', 'context_id'),
      });
    }

    this.eventEmitter.emit(eventName, payloadWithEvent);
  }

  async ingestChatEvent(event: ChatEventEnvelopeV1Shape): Promise<void> {
    await this.ingestDomainEvent('chat', event);
  }

  private async publishWorkflowLifecycleBestEffort(input: {
    runId: string;
    status: WorkflowLifecycleStatus;
    eventName: string;
    correlationId?: string;
    occurredAt: string;
    scopeId?: string;
    contextId?: string;
  }): Promise<void> {
    if (!this.pluginEventPublisher) {
      return;
    }

    try {
      await this.pluginEventPublisher.publishWorkflowRunLifecycleEvent(input);
    } catch {
      // Best-effort publishing must not fail workflow domain ingestion.
    }
  }
}
