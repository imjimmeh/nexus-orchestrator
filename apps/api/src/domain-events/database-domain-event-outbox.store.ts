import { Injectable } from '@nestjs/common';
import type {
  DomainEventEnvelope,
  DomainEventOutboxRecord,
  DomainEventOutboxStore,
} from './domain-event-bus.types';
import { DomainEventOutboxEntity } from './database/entities/domain-event-outbox.entity';
import { DomainEventOutboxRepository } from './database/repositories/domain-event-outbox.repository';
import { sanitizeOutboxPayload } from './outbox-payload-sanitizer';

@Injectable()
export class DatabaseDomainEventOutboxStore implements DomainEventOutboxStore {
  constructor(private readonly repo: DomainEventOutboxRepository) {}

  async append(event: DomainEventEnvelope): Promise<DomainEventOutboxRecord> {
    const entity = new DomainEventOutboxEntity();
    entity.eventId = event.eventId;
    entity.eventType = event.eventType;
    entity.aggregateId = event.aggregateId;
    entity.aggregateType = event.aggregateType;
    entity.payload = sanitizeOutboxPayload(event.payload);
    entity.correlationId = event.correlationId ?? null;
    entity.causationId = event.causationId ?? null;
    entity.occurredAt = event.occurredAt;
    entity.deliveryStatus = 'pending';
    entity.attemptCount = 0;
    entity.lastError = null;

    const saved = await this.repo.save(entity);
    return this.toRecord(saved);
  }

  async listPending(limit = 100): Promise<DomainEventOutboxRecord[]> {
    const rows = await this.repo.findPending(limit);
    return rows.map((row) => this.toRecord(row));
  }

  async markDelivered(eventId: string): Promise<void> {
    await this.repo.updateStatus(eventId, 'delivered');
  }

  async markFailed(eventId: string, error: Error): Promise<void> {
    await this.repo.incrementAttemptCount(eventId);
    await this.repo.updateStatus(eventId, 'failed', {
      lastError: error.message,
    });
  }

  private toRecord(entity: DomainEventOutboxEntity): DomainEventOutboxRecord {
    return {
      eventId: entity.eventId,
      eventType: entity.eventType,
      aggregateId: entity.aggregateId,
      aggregateType: entity.aggregateType,
      payload: { ...entity.payload },
      correlationId: entity.correlationId ?? undefined,
      causationId: entity.causationId ?? undefined,
      occurredAt: entity.occurredAt,
      deliveryStatus: entity.deliveryStatus,
      attemptCount: entity.attemptCount,
      lastError: entity.lastError ?? undefined,
      persistedAt: entity.persistedAt,
    };
  }
}
