import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('learning_candidates')
@Index('uq_learning_candidates_fingerprint', ['fingerprint'], { unique: true })
@Index('idx_learning_candidates_status_score', ['status', 'score'])
@Index('idx_learning_candidates_scope_status', [
  'scope_type',
  'scopeId',
  'status',
])
@Index('idx_learning_candidates_routing_target', ['routing_target'])
export class LearningCandidate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'scope_type',
    type: 'varchar',
    length: 80,
    default: 'global',
  })
  scope_type!: string;

  @Column({ name: 'scope_id', type: 'varchar', length: 160, nullable: true })
  scopeId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  candidate_type!: string;

  @Column({ type: 'varchar', length: 220 })
  title!: string;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'jsonb', default: {} })
  signals_json!: Record<string, unknown>;

  @Column({ type: 'double precision', default: 0 })
  score!: number;

  @Column({ type: 'double precision', default: 0 })
  confidence!: number;

  @Column({ type: 'integer', default: 1 })
  recurrence_count!: number;

  @Column({ type: 'integer', default: 1 })
  stage_diversity_count!: number;

  @Column({ type: 'double precision', default: 0 })
  failure_reduction_relevance!: number;

  @Column({ type: 'double precision', default: 1 })
  recency_decay!: number;

  @Column({ type: 'double precision', default: 0 })
  source_quality_confidence!: number;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  diagnostics_json!: Record<string, unknown> | null;

  /**
   * Deterministic scope home inferred by `LearningRouterService`
   * (EPIC-212 Phase-2 Task 8): one of `project | global | agent_preference |
   * skill_new | skill_patch | drop`. Populated by the nightly clusterer pass
   * before the sweep/promotion consume it. A null value (legacy rows) falls
   * back to the `project`-default promotion behaviour.
   */
  @Column({
    name: 'routing_target',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  routing_target!: string | null;

  @Column({ type: 'uuid', nullable: true })
  promoted_memory_segment_id!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  promoted_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  human_approved_at!: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  rejected_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejected_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  rejection_reason!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  archived_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  archive_reason!: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  first_seen_at!: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_seen_at!: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
