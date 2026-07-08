import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../../users/database/entities/user.entity';

@Entity('notifications')
@Index('idx_notifications_status_channel_created', [
  'status',
  'channel',
  'createdAt',
])
@Index('idx_notifications_user_id_created', ['userId', 'createdAt'])
@Index('idx_notifications_event_type', ['eventType'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'scope_id', type: 'uuid', nullable: true })
  scopeId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  channel!: string;

  @Column({ name: 'external_recipient_id', type: 'varchar', length: 128 })
  externalRecipientId!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: 'pending' | 'sent' | 'failed';

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType!: string;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'sent_at', nullable: true, type: 'timestamptz' })
  sentAt!: Date | null;

  @Column({ name: 'failed_at', nullable: true, type: 'timestamptz' })
  failedAt!: Date | null;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage!: string | null;

  @Column({ name: 'read_at', nullable: true, type: 'timestamptz' })
  readAt!: Date | null;

  @Column({ name: 'read_by_user_id', nullable: true, type: 'uuid' })
  readByUserId!: string | null;
}
