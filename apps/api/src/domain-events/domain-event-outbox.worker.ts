import { Inject, Injectable } from '@nestjs/common';
import type {
  DomainEventBus,
  DomainEventOutboxStore,
} from './domain-event-bus.types';
import {
  DOMAIN_EVENT_OUTBOX_STORE,
  LOCAL_DOMAIN_EVENT_FANOUT,
} from './outbox-domain-event.bus';

@Injectable()
export class DomainEventOutboxWorker {
  constructor(
    @Inject(DOMAIN_EVENT_OUTBOX_STORE)
    private readonly outboxStore: DomainEventOutboxStore,
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly localFanout: DomainEventBus,
  ) {}

  async drainPending(
    limit = 100,
  ): Promise<{ delivered: number; failed: number }> {
    let delivered = 0;
    let failed = 0;
    const pending = await this.outboxStore.listPending(limit);

    for (const event of pending) {
      try {
        await this.localFanout.publish(event);
        await this.outboxStore.markDelivered(event.eventId);
        delivered += 1;
      } catch (error) {
        await this.outboxStore.markFailed(
          event.eventId,
          error instanceof Error ? error : new Error(String(error)),
        );
        failed += 1;
      }
    }

    return { delivered, failed };
  }
}
