import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

type ProfileMemoryType = 'preference' | 'fact' | 'history';

@Entity('chat_profile_memory')
@Index('idx_chat_profile_memory_profile_updated', ['profile_id', 'updated_at'])
@Index('idx_chat_profile_memory_profile_normalized', [
  'profile_id',
  'normalized_content',
])
export class ChatProfileMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  profile_id: string;

  @Column({ type: 'uuid', nullable: true })
  last_chat_session_id?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'fact' })
  memory_type: ProfileMemoryType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  normalized_content: string;

  @Column({ type: 'smallint', default: 50 })
  confidence_score: number;

  @Column({ type: 'int', default: 1 })
  promotion_count: number;

  @Column({ type: 'timestamptz' })
  last_promoted_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_accessed_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  provenance?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
