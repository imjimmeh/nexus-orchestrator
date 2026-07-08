import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('event_ledger')
@Index(['occurred_at'])
@Index(['domain', 'event_name', 'occurred_at'])
@Index(['workflow_run_id', 'occurred_at'])
@Index(['scopeId', 'contextId', 'occurred_at'])
export class EventLedger {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  domain!: string;

  @Column()
  event_name!: string;

  @Column()
  outcome!: 'success' | 'failure' | 'denied' | 'in_progress' | 'skipped';

  @Column({ default: 'info' })
  severity!: 'info' | 'warn' | 'error' | 'critical';

  @Column({ default: 'api' })
  source!: string;

  @Column({ nullable: true })
  actor_type?: 'user' | 'agent' | 'system';

  @Column({ nullable: true })
  actor_id?: string;

  @Column({ name: 'scope_id', nullable: true })
  scopeId?: string;

  @Column({ name: 'context_id', nullable: true })
  contextId?: string;

  @Column({ nullable: true })
  workflow_id?: string;

  @Column({ nullable: true })
  workflow_run_id?: string;

  @Column({ nullable: true })
  job_id?: string;

  @Column({ nullable: true })
  step_id?: string;

  @Column({ nullable: true })
  tool_id?: string;

  @Column({ nullable: true })
  tool_name?: string;

  @Column({ nullable: true })
  subagent_execution_id?: string;

  @Column({ nullable: true })
  session_tree_id?: string;

  @Column({ nullable: true })
  request_id?: string;

  @Column({ nullable: true })
  @Index()
  correlation_id?: string;

  @Column({ nullable: true })
  parent_event_id?: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @Column({ nullable: true })
  error_code?: string;

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  @CreateDateColumn()
  occurred_at!: Date;
}
