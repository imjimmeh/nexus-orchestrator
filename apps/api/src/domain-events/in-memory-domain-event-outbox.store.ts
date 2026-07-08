import { Injectable } from '@nestjs/common';
import type {
  DomainEventEnvelope,
  DomainEventOutboxRecord,
  DomainEventOutboxStore,
} from './domain-event-bus.types';

@Injectable()
export class InMemoryDomainEventOutboxStore implements DomainEventOutboxStore {
  private readonly records = new Map<string, DomainEventOutboxRecord>();

  async append(event: DomainEventEnvelope): Promise<DomainEventOutboxRecord> {
    await Promise.resolve();
    const record: DomainEventOutboxRecord = {
      ...event,
      payload: { ...event.payload },
      deliveryStatus: 'pending',
      attemptCount: 0,
      persistedAt: new Date(),
    };
    this.records.set(event.eventId, record);
    return { ...record, payload: { ...record.payload } };
  }

  async markDelivered(eventId: string): Promise<void> {
    await Promise.resolve();
    const record = this.requireRecord(eventId);
    this.records.set(eventId, { ...record, deliveryStatus: 'delivered' });
  }

  async markFailed(eventId: string, error: Error): Promise<void> {
    await Promise.resolve();
    const record = this.requireRecord(eventId);
    this.records.set(eventId, {
      ...record,
      deliveryStatus: 'failed',
      attemptCount: record.attemptCount + 1,
      lastError: error.message,
    });
  }

  async listPending(limit = 100): Promise<DomainEventOutboxRecord[]> {
    await Promise.resolve();
    return [...this.records.values()]
      .filter((record) => record.deliveryStatus === 'pending')
      .slice(0, limit)
      .map((record) => ({ ...record, payload: { ...record.payload } }));
  }

  private requireRecord(eventId: string): DomainEventOutboxRecord {
    const record = this.records.get(eventId);
    if (!record) {
      throw new Error(`Domain event outbox record '${eventId}' not found`);
    }
    return record;
  }
}
