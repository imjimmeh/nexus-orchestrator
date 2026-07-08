import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  DomainEventBus,
  DomainEventEnvelope,
  DomainEventHandler,
} from './domain-event-bus.types';

@Injectable()
export class InProcessDomainEventBus implements DomainEventBus {
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  constructor(@Optional() private readonly eventEmitter?: EventEmitter2) {}

  on(eventType: string, handler: DomainEventHandler): void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    await this.publishAll([event]);
  }

  async publishAll(events: DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await this.deliver(event);
    }
  }

  private async deliver(event: DomainEventEnvelope): Promise<void> {
    for (const handler of this.handlers.get(event.eventType) ?? []) {
      await handler(event);
    }
    if (this.eventEmitter) {
      await this.eventEmitter.emitAsync(event.eventType, event);
    }
  }
}
