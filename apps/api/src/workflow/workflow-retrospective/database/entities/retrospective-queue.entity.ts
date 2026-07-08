import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * `retrospective_queue` — the durable hand-off table between a terminal
 * workflow run and the EPIC-212 retrospective analyst pipeline.
 *
 * One row per terminal run (the UNIQUE index on `workflow_run_id` makes
 * enqueue idempotent: a re-emitted `workflow.run.completed` /
 * `workflow.run.failed` event for the same run is a no-op rather than a
 * duplicate). The cheap deterministic gate (Phase-2 Task 2) later writes
 * `interest_score` / `priority` / `signals_json` back onto the row, and the
 * budget-capped drain (Task 3) claims the highest-interest `queued` rows via
 * the `(status, priority, interest_score DESC)` index.
 *
 * Scope-neutral: `scope_id` is the only scope reference and `signals_json`
 * never carries domain-specific identifiers.
 */
@Entity('retrospective_queue')
@Index('uq_retrospective_queue_workflow_run_id', ['workflow_run_id'], {
  unique: true,
  where: '"workflow_run_id" IS NOT NULL',
})
@Index('uq_retrospective_queue_chat_session_id', ['chat_session_id'], {
  unique: true,
  where: '"chat_session_id" IS NOT NULL',
})
@Index('idx_retrospective_queue_status_priority', [
  'status',
  'priority',
  'interest_score',
])
export class RetrospectiveQueue {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_run_id', type: 'uuid', nullable: true })
  workflow_run_id!: string | null;

  @Column({ name: 'chat_session_id', type: 'uuid', nullable: true })
  chat_session_id!: string | null;

  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 32,
    default: 'workflow_run',
  })
  source_type!: 'workflow_run' | 'chat_session';

  @Column({ name: 'scope_id', type: 'varchar', length: 160, nullable: true })
  scope_id!: string | null;

  @Column({ name: 'terminal_status', type: 'varchar', length: 32 })
  terminal_status!: string;

  @Column({ name: 'interest_score', type: 'double precision', default: 0 })
  interest_score!: number;

  @Column({ type: 'varchar', length: 16, default: 'normal' })
  priority!: string;

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status!: string;

  @Column({ name: 'signals_json', type: 'jsonb', default: {} })
  signals_json!: Record<string, unknown>;

  @Column({ name: 'enqueued_at', type: 'timestamptz', default: () => 'NOW()' })
  enqueued_at!: Date;

  @Column({ name: 'drained_at', type: 'timestamptz', nullable: true })
  drained_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
