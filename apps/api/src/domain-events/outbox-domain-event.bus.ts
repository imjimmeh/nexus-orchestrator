import { Inject, Injectable } from '@nestjs/common';
import type {
  DomainEventBus,
  DomainEventEnvelope,
  DomainEventOutboxStore,
} from './domain-event-bus.types';

export const DOMAIN_EVENT_OUTBOX_STORE = Symbol('DOMAIN_EVENT_OUTBOX_STORE');
export const LOCAL_DOMAIN_EVENT_FANOUT = Symbol('LOCAL_DOMAIN_EVENT_FANOUT');

@Injectable()
export class OutboxDomainEventBus implements DomainEventBus {
  constructor(
    @Inject(DOMAIN_EVENT_OUTBOX_STORE)
    private readonly outboxStore: DomainEventOutboxStore,
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly localFanout?: DomainEventBus,
  ) {}

  async publish(event: DomainEventEnvelope): Promise<void> {
    await this.outboxStore.append(event);
    await this.localFanout?.publish(event);
  }

  async publishAll(events: DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
