import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PluginEventDeliveryMode,
  PluginEventDeliveryStatus,
} from './plugin-event-delivery.types';

@Entity('plugin_event_deliveries')
@Check(
  'chk_plugin_event_deliveries_status',
  "status IN ('pending', 'delivering', 'delivered', 'failed', 'dead_lettered')",
)
@Check(
  'chk_plugin_event_deliveries_delivery_mode',
  "delivery_mode IN ('blocking', 'non_blocking')",
)
@Index('idx_plugin_event_deliveries_status', ['status'])
@Index('idx_plugin_event_deliveries_next_attempt_at', ['next_attempt_at'])
@Index('idx_plugin_event_deliveries_plugin_id', ['plugin_id'])
@Index('idx_plugin_event_deliveries_topic', ['topic'])
@Index('idx_plugin_event_deliveries_contribution_id', ['contribution_id'])
export class PluginEventDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  plugin_id!: string;

  @Column({ type: 'varchar', length: 64 })
  plugin_version!: string;

  @Column({ type: 'varchar', length: 255 })
  contribution_id!: string;

  @Column({ type: 'varchar', length: 255 })
  topic!: string;

  @Column({ type: 'varchar', length: 255 })
  event_name!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  correlation_id!: string | null;

  @Column({ type: 'varchar', length: 32 })
  delivery_mode!: PluginEventDeliveryMode;

  @Column({ type: 'varchar', length: 32 })
  status!: PluginEventDeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempt_count!: number;

  @Column({ type: 'integer', default: 3 })
  max_attempts!: number;

  @Column({ type: 'integer', default: 1000 })
  retry_initial_delay_ms!: number;

  @Column({ type: 'double precision', default: 2 })
  retry_backoff_multiplier!: number;

  @Column({ type: 'boolean', default: true })
  dead_letter_enabled!: boolean;

  @Column({ type: 'timestamptz' })
  next_attempt_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error_code!: string | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  error_metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
