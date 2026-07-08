import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import type { DomainEventDeliveryStatus } from '../../domain-event-bus.types';

@Entity('domain_event_outbox')
@Check(
  'chk_domain_event_outbox_delivery_status',
  "delivery_status IN ('pending', 'delivered', 'failed')",
)
@Index('idx_domain_event_outbox_status_created', [
  'deliveryStatus',
  'persistedAt',
])
export class DomainEventOutboxEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType!: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 255 })
  aggregateId!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 255 })
  aggregateType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({
    name: 'causation_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  causationId!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({
    name: 'delivery_status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  deliveryStatus!: DomainEventDeliveryStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'persisted_at', type: 'timestamptz' })
  persistedAt!: Date;
}
