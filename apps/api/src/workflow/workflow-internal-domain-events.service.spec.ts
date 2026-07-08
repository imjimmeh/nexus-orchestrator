import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatEventEnvelopeV1Shape } from '@nexus/core';
import { WorkflowInternalDomainEventsController } from './workflow-internal-domain-events.controller';
import { WorkflowInternalDomainEventsService } from './workflow-internal-domain-events.service';

const externalEventName = 'external.resource.changed.v1';
const externalStatusChangedEventName = 'external.resource.status_changed.v1';

describe('WorkflowInternalDomainEvents', () => {
  const eventLedger = {
    emitBestEffort: vi.fn(),
  };

  const eventEmitter = { emit: vi.fn() } as unknown as EventEmitter2;
  const pluginEventPublisher = {
    publishWorkflowRunLifecycleEvent: vi.fn().mockResolvedValue({
      ok: true,
      topic: 'workflow.run.started.v1',
      deliveries: [],
    }),
  };

  let controller: WorkflowInternalDomainEventsController;
  let service: WorkflowInternalDomainEventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    eventLedger.emitBestEffort.mockResolvedValue(undefined);
    service = new WorkflowInternalDomainEventsService(
      eventLedger as never,
      eventEmitter,
      undefined,
      pluginEventPublisher as never,
    );
    controller = new WorkflowInternalDomainEventsController(service);
  });

  describe('WorkflowInternalDomainEventsService', () => {
    it('ingestDomainEvent should extract scopeId and contextId from payload', async () => {
      const event = {
        eventType: 'test.event',
        correlationId: 'corr-1',
        payload: {
          scopeId: 'scope-123',
          contextId: 'item-456',
          data: 'info',
        },
      };

      await service.ingestDomainEvent('test-domain', event);

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'test-domain',
          eventName: 'test.event',
          correlationId: 'corr-1',
          context: expect.objectContaining({
            scopeId: 'scope-123',
            contextId: 'item-456',
            contextType: 'resource',
          }),
        }),
      );
    });

    it('ingestDomainEvent should handle missing scopeId/contextId', async () => {
      const event = {
        eventType: 'test.event',
        correlationId: 'corr-1',
        payload: {
          data: 'info',
        },
      };

      await service.ingestDomainEvent('test-domain', event);

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'test-domain',
          context: undefined,
        }),
      );
    });

    it('records and emits external status lifecycle payloads without domain-specific validation', async () => {
      const payload = {
        scopeId: 'scope-1',
        contextId: 'resource-1',
        status: 'active',
        previousStatus: 'queued',
        actor: 'automation',
        changedAt: '2026-05-12T00:01:00.000Z',
        resource: {
          id: 'resource-1',
          status: 'active',
          label: 'Neutral resource',
        },
      };

      await service.ingestDomainEvent('external', {
        eventName: externalStatusChangedEventName,
        eventId: 'evt-external-1',
        payload,
      });

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'external',
          eventName: externalStatusChangedEventName,
          context: expect.objectContaining({
            scopeId: 'scope-1',
            contextId: 'resource-1',
            contextType: 'resource',
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        externalStatusChangedEventName,
        expect.objectContaining(payload),
      );
      const emittedPayload = vi.mocked(eventEmitter.emit).mock.calls[0][1] as
        | Record<string, unknown>
        | undefined;
      expect(Object.keys(emittedPayload ?? {})).not.toContain('eventId');
      expect(emittedPayload?.eventId).toBe('evt-external-1');
    });

    it('accepts arbitrary missing and extra payload fields for external events', async () => {
      await expect(
        service.ingestDomainEvent('external', {
          eventName: externalEventName,
          payload: {
            extraField: 'allowed',
          },
        }),
      ).resolves.toBeUndefined();

      expect(eventLedger.emitBestEffort).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        externalEventName,
        expect.objectContaining({
          extraField: 'allowed',
        }),
      );
    });

    it('publishes external events to the durable bus before local fanout', async () => {
      const calls: string[] = [];
      const occurredAt = '2026-05-12T00:02:00.000Z';
      const durableBus = {
        publish: vi.fn(() => {
          calls.push('durable');
          return Promise.resolve();
        }),
        publishAll: vi.fn(),
      };
      vi.mocked(eventEmitter.emit).mockImplementation(() => {
        calls.push('local');
        return true;
      });
      service = new WorkflowInternalDomainEventsService(
        eventLedger as never,
        eventEmitter,
        durableBus,
        pluginEventPublisher as never,
      );

      await service.ingestDomainEvent('external', {
        eventName: externalEventName,
        eventId: 'evt-durable-1',
        correlationId: 'corr-durable-1',
        occurredAt,
        payload: {
          scopeId: 'scope-1',
          contextId: 'resource-1',
          value: 'changed',
        },
      });

      expect(durableBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-durable-1',
          eventType: externalEventName,
          aggregateId: 'resource-1',
          aggregateType: 'external',
          correlationId: 'corr-durable-1',
          occurredAt: new Date(occurredAt),
        }),
      );
      expect(calls).toEqual(['durable', 'local']);
    });

    it('publishes workflow run started lifecycle events to plugin event publisher', async () => {
      await service.ingestDomainEvent('workflow', {
        eventName: 'workflow.run.started.v1',
        correlationId: 'corr-workflow-1',
        occurredAt: '2026-05-18T12:10:00.000Z',
        payload: {
          runId: 'run-1',
          scopeId: 'scope-1',
          contextId: 'context-1',
        },
      });

      expect(
        pluginEventPublisher.publishWorkflowRunLifecycleEvent,
      ).toHaveBeenCalledWith({
        runId: 'run-1',
        status: 'started',
        eventName: 'workflow.run.started.v1',
        correlationId: 'corr-workflow-1',
        occurredAt: '2026-05-18T12:10:00.000Z',
        scopeId: 'scope-1',
        contextId: 'context-1',
      });
    });

    it('does not publish plugin workflow lifecycle events for unmapped domain events', async () => {
      await service.ingestDomainEvent('workflow', {
        eventName: 'workflow.run.cancelled.v1',
        payload: {
          runId: 'run-1',
          scopeId: 'scope-1',
          contextId: 'context-1',
        },
      });

      expect(
        pluginEventPublisher.publishWorkflowRunLifecycleEvent,
      ).not.toHaveBeenCalled();
    });

    it('reads snake_case fields from ingestDomainEvent', async () => {
      await service.ingestDomainEvent('external', {
        event_type: externalEventName,
        source_service: 'external-source',
        correlation_id: 'corr-snake',
        event_id: 'evt-snake-1',
        payload: {
          scopeId: 'scope-2',
          contextId: 'resource-2',
          value: 'changed',
        },
      });

      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'external',
          eventName: externalEventName,
          source: 'external-source',
          correlationId: 'corr-snake',
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        externalEventName,
        expect.objectContaining({
          scopeId: 'scope-2',
          contextId: 'resource-2',
          value: 'changed',
        }),
      );
    });
  });

  describe('WorkflowInternalDomainEventsController', () => {
    describe('POST /internal/chat/events', () => {
      it('records chat events in the event ledger', async () => {
        const body = {
          event_id: 'chat-event-1',
          event_type: 'chat.message.sent.v1',
          event_version: 'v1',
          occurred_at: '2026-05-12T00:00:00.000Z',
          correlation_id: 'corr-2',
          source_service: 'chat',
          payload: {
            chat_session_id: 'session-1',
            message_id: 'msg-1',
            direction: 'outbound',
            channel: 'telegram',
            text: 'hello',
          },
        } satisfies ChatEventEnvelopeV1Shape;

        await controller.ingestChatEvent(body);

        expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            domain: 'chat',
            eventName: 'chat.message.sent.v1',
            source: 'chat',
            correlationId: 'corr-2',
          }),
        );
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'chat.message.sent.v1',
          expect.objectContaining({
            eventId: 'chat-event-1',
          }),
        );
      });
    });

    describe('POST /internal/:domain/events', () => {
      it('records generic domain events', async () => {
        const body = {
          eventId: 'evt-1',
          eventType: 'custom.event',
          payload: { foo: 'bar' },
        };

        const result = await controller.ingestDomainEvent(
          'custom-domain',
          body,
        );

        expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            domain: 'custom-domain',
            eventName: 'custom.event',
          }),
        );
        expect(result.success).toBe(true);
        expect(result.data.domain).toBe('custom-domain');
      });
    });
  });
});
