import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

type PromotionAuditAction = 'promoted' | 'updated' | 'archived';

@Entity('chat_memory_promotion_audit')
@Index('idx_chat_memory_promotion_audit_idempotency', ['idempotency_key'], {
  unique: true,
})
@Index('idx_chat_memory_promotion_audit_profile_created', [
  'profile_id',
  'created_at',
])
export class ChatMemoryPromotionAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  chat_session_id?: string | null;

  @Column({ type: 'uuid' })
  profile_id: string;

  @Column({ type: 'uuid', nullable: true })
  session_memory_id?: string | null;

  @Column({ type: 'uuid' })
  profile_memory_id: string;

  @Column({ type: 'varchar', length: 16 })
  action: PromotionAuditAction;

  @Column({ type: 'varchar', length: 255 })
  idempotency_key: string;

  @Column({ type: 'varchar', length: 64 })
  trigger_reason: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;
}
