import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('chat_messages')
@Index('idx_chat_messages_session_created', ['chat_session_id', 'created_at'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  chat_session_id: string;

  @Column({ type: 'varchar', length: 32 })
  direction: 'inbound' | 'outbound';

  @Column({ type: 'varchar', length: 32 })
  sender: 'user' | 'assistant' | 'system';

  @Column({ type: 'varchar', length: 64 })
  channel: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  provider_message_id?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  correlation_id?: string | null;

  @Column({ type: 'varchar', length: 64 })
  event_type: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'uuid', nullable: true })
  run_id?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  run_status?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
