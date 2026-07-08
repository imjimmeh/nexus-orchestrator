import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('budget_decision_events')
@Index(['correlation_id'])
@Index(['scope_id'])
@Index(['context_type', 'context_id'])
@Index(['created_at'])
export class BudgetDecisionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlation_id!: string | null;

  @Column({ name: 'policy_id', type: 'uuid', nullable: true })
  policy_id!: string | null;

  @Column({ name: 'scope_id', type: 'varchar', nullable: true })
  scope_id!: string | null;

  @Column({ name: 'context_type', type: 'varchar', length: 64 })
  context_type!: string;

  @Column({ name: 'context_id', type: 'varchar' })
  context_id!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  action_type!: string;

  @Column({ type: 'varchar', length: 32 })
  decision!: string;

  @Column({ name: 'reason_code', type: 'varchar', length: 64 })
  reason_code!: string;

  @Column({ name: 'estimated_cost_cents', type: 'integer', nullable: true })
  estimated_cost_cents!: number | null;

  @Column({ name: 'remaining_budget_cents', type: 'integer', nullable: true })
  remaining_budget_cents!: number | null;

  @Column({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approval_request_id!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
