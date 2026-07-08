import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DomainEventDeliveryStatus } from '../../domain-event-bus.types';
import { DomainEventOutboxEntity } from '../entities/domain-event-outbox.entity';

@Injectable()
export class DomainEventOutboxRepository {
  constructor(
    @InjectRepository(DomainEventOutboxEntity)
    private readonly repo: Repository<DomainEventOutboxEntity>,
  ) {}

  save(entity: DomainEventOutboxEntity): Promise<DomainEventOutboxEntity> {
    return this.repo.save(entity);
  }

  findPending(limit = 100): Promise<DomainEventOutboxEntity[]> {
    return this.repo.find({
      where: { deliveryStatus: 'pending' },
      order: { persistedAt: 'ASC' },
      take: limit,
    });
  }

  async updateStatus(
    eventId: string,
    status: Extract<DomainEventDeliveryStatus, 'delivered' | 'failed'>,
    meta?: { lastError?: string },
  ): Promise<void> {
    await this.repo.update(eventId, {
      deliveryStatus: status,
      ...(meta?.lastError !== undefined && { lastError: meta.lastError }),
    });
  }

  async incrementAttemptCount(eventId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(DomainEventOutboxEntity)
      .set({ attemptCount: () => 'attempt_count + 1' })
      .where('event_id = :eventId', { eventId })
      .execute();
  }
}
