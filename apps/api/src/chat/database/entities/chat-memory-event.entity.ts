import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('chat_memory_events')
@Index('idx_chat_memory_events_type_created', ['event_type', 'created_at'])
@Index('idx_chat_memory_events_session_created', [
  'chat_session_id',
  'created_at',
])
export class ChatMemoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  event_id: string;

  @Column({ type: 'varchar', length: 64 })
  event_type: string;

  @Column({ type: 'varchar', length: 128 })
  correlation_id: string;

  @Column({ type: 'varchar', length: 128 })
  chat_session_id: string;

  @Column({ type: 'uuid' })
  memory_id: string;

  @Column({ type: 'varchar', length: 16 })
  action: string;

  @Column({ type: 'uuid', nullable: true })
  profile_id?: string | null;

  @Column({ type: 'jsonb' })
  envelope: Record<string, unknown>;

  @CreateDateColumn()
  created_at: Date;
}
