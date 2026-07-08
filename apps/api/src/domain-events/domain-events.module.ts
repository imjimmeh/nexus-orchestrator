import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEventOutboxEntity } from './database/entities/domain-event-outbox.entity';
import { DomainEventOutboxRepository } from './database/repositories/domain-event-outbox.repository';
import { DatabaseDomainEventOutboxStore } from './database-domain-event-outbox.store';
import { DomainEventOutboxWorker } from './domain-event-outbox.worker';
import { InProcessDomainEventBus } from './in-process-domain-event.bus';
import {
  OutboxDomainEventBus,
  DOMAIN_EVENT_OUTBOX_STORE,
  LOCAL_DOMAIN_EVENT_FANOUT,
} from './outbox-domain-event.bus';

@Module({
  imports: [TypeOrmModule.forFeature([DomainEventOutboxEntity])],
  providers: [
    DomainEventOutboxRepository,
    DatabaseDomainEventOutboxStore,
    {
      provide: DOMAIN_EVENT_OUTBOX_STORE,
      useExisting: DatabaseDomainEventOutboxStore,
    },
    InProcessDomainEventBus,
    {
      provide: LOCAL_DOMAIN_EVENT_FANOUT,
      useExisting: InProcessDomainEventBus,
    },
    OutboxDomainEventBus,
    DomainEventOutboxWorker,
  ],
  exports: [
    DOMAIN_EVENT_OUTBOX_STORE,
    LOCAL_DOMAIN_EVENT_FANOUT,
    OutboxDomainEventBus,
    DomainEventOutboxWorker,
    InProcessDomainEventBus,
    DomainEventOutboxRepository,
  ],
})
export class DomainEventsModule {}
