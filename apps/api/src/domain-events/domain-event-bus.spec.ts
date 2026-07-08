import { describe, expect, it, vi } from 'vitest';
import type { DomainEventEnvelope } from './domain-event-bus.types';
import { DomainEventOutboxWorker } from './domain-event-outbox.worker';
import { InMemoryDomainEventOutboxStore } from './in-memory-domain-event-outbox.store';
import { InProcessDomainEventBus } from './in-process-domain-event.bus';
import { OutboxDomainEventBus } from './outbox-domain-event.bus';

const event: DomainEventEnvelope = {
  eventId: 'event-1',
  eventType: 'workflow.run.status_changed',
  aggregateId: 'run-1',
  aggregateType: 'workflow_run',
  payload: { status: 'running' },
  correlationId: 'corr-1',
  causationId: 'cause-1',
  occurredAt: new Date('2026-05-14T00:00:00.000Z'),
};

describe('domain event buses', () => {
  it('in-process bus fans out to registered handlers', async () => {
    const bus = new InProcessDomainEventBus();
    const handler = vi.fn();
    bus.on(event.eventType, handler);

    await bus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('outbox bus persists before local fanout', async () => {
    const outbox = new InMemoryDomainEventOutboxStore();
    const calls: string[] = [];
    const fanout = {
      publish: vi.fn(() => {
        calls.push('fanout');
        return Promise.resolve();
      }),
      publishAll: vi.fn(),
    };
    const appendSpy = vi.spyOn(outbox, 'append').mockImplementation((input) => {
      calls.push('append');
      return InMemoryDomainEventOutboxStore.prototype.append.call(
        outbox,
        input,
      );
    });
    const bus = new OutboxDomainEventBus(outbox, fanout);

    await bus.publish(event);

    expect(appendSpy).toHaveBeenCalledWith(event);
    expect(fanout.publish).toHaveBeenCalledWith(event);
    expect(calls).toEqual(['append', 'fanout']);
  });

  it('outbox worker records delivery attempts and failure state', async () => {
    const outbox = new InMemoryDomainEventOutboxStore();
    await outbox.append(event);
    const fanout = {
      publish: vi.fn().mockRejectedValue(new Error('boom')),
      publishAll: vi.fn(),
    };
    const worker = new DomainEventOutboxWorker(outbox, fanout);

    await expect(worker.drainPending()).resolves.toEqual({
      delivered: 0,
      failed: 1,
    });
    expect(await outbox.listPending()).toEqual([]);
  });
});
