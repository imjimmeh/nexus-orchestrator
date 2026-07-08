import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('runtime_feedback_signal_groups')
@Index(
  'uq_runtime_feedback_signal_groups_fingerprint',
  ['dedupe_fingerprint'],
  {
    unique: true,
  },
)
@Index('idx_runtime_feedback_signal_groups_type_scope', [
  'signal_type',
  'scope_type',
  'scopeId',
])
@Index('idx_runtime_feedback_signal_groups_candidate', ['candidateId'])
export class RuntimeFeedbackSignalGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512 })
  dedupe_fingerprint!: string;

  @Column({ type: 'varchar', length: 80 })
  signal_type!: string;

  @Column({ type: 'varchar', length: 120 })
  source_module!: string;

  @Column({ type: 'varchar', length: 80 })
  scope_type!: string;

  @Column({ name: 'scope_id', type: 'varchar', length: 160, nullable: true })
  scopeId!: string | null;

  @Column({ type: 'jsonb', default: {} })
  actor_json!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  affected_json!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: [] })
  evidence_json!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: [] })
  examples_json!: Array<Record<string, unknown>>;

  @Column({ type: 'integer', default: 0 })
  occurrence_count!: number;

  @Column({ type: 'integer', default: 0 })
  window_occurrence_count!: number;

  @Column({ type: 'double precision', default: 0 })
  max_confidence!: number;

  @Column({ type: 'varchar', length: 20 })
  max_severity!: string;

  @Column({ type: 'timestamptz' })
  first_seen_at!: Date;

  @Column({ type: 'timestamptz' })
  window_started_at!: Date;

  @Column({ type: 'timestamptz' })
  last_seen_at!: Date;

  @Column({ name: 'candidate_id', type: 'uuid', nullable: true })
  candidateId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  candidate_created_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cooldown_until!: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  last_skipped_reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  diagnostics_json!: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
