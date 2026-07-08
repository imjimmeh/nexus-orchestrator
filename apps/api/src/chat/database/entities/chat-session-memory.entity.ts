import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

type SessionMemoryRole = 'user' | 'assistant' | 'system';
type SessionMemoryType = 'preference' | 'fact' | 'history';

@Entity('chat_session_memory')
@Index('idx_chat_session_memory_session_created', [
  'chat_session_id',
  'created_at',
])
@Index('idx_chat_session_memory_profile_created', ['profile_id', 'created_at'])
export class ChatSessionMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  chat_session_id: string;

  @Column({ type: 'uuid' })
  profile_id: string;

  @Column({ type: 'uuid', nullable: true })
  source_message_id?: string | null;

  @Column({ type: 'varchar', length: 32 })
  source_role: SessionMemoryRole;

  @Column({ type: 'varchar', length: 32, default: 'history' })
  memory_type: SessionMemoryType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  normalized_content: string;

  @Column({ type: 'smallint', default: 50 })
  importance_score: number;

  @Column({ type: 'jsonb', nullable: true })
  provenance?: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  promoted_profile_memory_id?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  distilled_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
