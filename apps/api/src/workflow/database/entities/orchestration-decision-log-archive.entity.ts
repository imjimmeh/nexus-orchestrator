import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('orchestration_decision_log_archive')
@Index('idx_orchestration_decision_log_archive_scope_id', ['scopeId'])
@Index('idx_orchestration_decision_log_archive_occurred_at', ['occurredAt'])
export class OrchestrationDecisionLogArchive {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId!: string;

  @Column({ name: 'session_id', type: 'varchar' })
  sessionId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'text' })
  decision!: string;

  @Column({ type: 'text' })
  rationale!: string;

  @Column({ type: 'text', nullable: true })
  outcome!: string | null;

  @CreateDateColumn({ name: 'archived_at', type: 'timestamptz' })
  archivedAt!: Date;
}
