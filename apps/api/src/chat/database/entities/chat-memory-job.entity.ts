import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

type MemoryJobType = 'distill_session' | 'consolidate_profile';
type MemoryJobStatus = 'pending' | 'running' | 'completed' | 'failed';

@Entity('chat_memory_jobs')
@Index('idx_chat_memory_jobs_status_scheduled', ['status', 'scheduled_at'])
@Index('idx_chat_memory_jobs_idempotency', ['idempotency_key'], {
  unique: true,
})
export class ChatMemoryJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  job_type: MemoryJobType;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: MemoryJobStatus;

  @Column({ type: 'uuid', nullable: true })
  chat_session_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  profile_id?: string | null;

  @Column({ type: 'varchar', length: 255 })
  idempotency_key: string;

  @Column({ type: 'varchar', length: 64 })
  trigger_reason: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 3 })
  max_attempts: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  scheduled_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  last_error?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
