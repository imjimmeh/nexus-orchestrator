import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('budget_usage_events')
@Index(['scope_id'])
@Index(['context_type', 'context_id'])
@Index(['created_at'])
export class BudgetUsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlation_id!: string | null;

  @Column({ name: 'scope_id', type: 'varchar', nullable: true })
  scope_id!: string | null;

  @Column({ name: 'context_type', type: 'varchar', length: 64 })
  context_type!: string;

  @Column({ name: 'context_id', type: 'varchar' })
  context_id!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 64 })
  actor_type!: string;

  @Column({ name: 'actor_id', type: 'varchar', nullable: true })
  actor_id!: string | null;

  @Column({ name: 'provider_name', type: 'varchar', nullable: true })
  provider_name!: string | null;

  @Column({ name: 'model_name', type: 'varchar', nullable: true })
  model_name!: string | null;

  @Column({ name: 'model_id', type: 'uuid', nullable: true })
  model_id!: string | null;

  @Column({ name: 'input_tokens', type: 'integer', nullable: true })
  input_tokens!: number | null;

  @Column({ name: 'output_tokens', type: 'integer', nullable: true })
  output_tokens!: number | null;

  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  total_tokens!: number | null;

  @Column({ name: 'estimated_cost_cents', type: 'integer', nullable: true })
  estimated_cost_cents!: number | null;

  @Column({ name: 'estimate_source', type: 'varchar', length: 64 })
  estimate_source!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
