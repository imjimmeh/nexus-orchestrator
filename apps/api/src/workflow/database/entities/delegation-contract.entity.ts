import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  DELEGATION_CONTRACT_STATUS_VALUES,
  DELEGATION_TARGET_TIER_VALUES,
} from './delegation-contract.entity.types';
import type {
  DelegationContractStatus,
  DelegationTargetTier,
} from './delegation-contract.entity.types';

export type {
  DelegationContractStatus,
  DelegationTargetTier,
} from './delegation-contract.entity.types';

@Entity('delegation_contracts')
@Index('idx_delegation_contracts_parent_status_priority', [
  'parent_container_id',
  'status',
  'queue_priority',
])
@Index('idx_delegation_contracts_run_created', [
  'workflow_run_id',
  'created_at',
])
export class DelegationContract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column()
  @Index()
  parent_container_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  parent_execution_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  parent_delegation_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  subagent_execution_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requester_agent_profile?: string | null;

  @Column()
  target_agent_profile!: string;

  @Column({ type: 'text' })
  objective!: string;

  @Column({ type: 'text' })
  task_prompt!: string;

  @Column({ type: 'jsonb', nullable: true })
  success_criteria?: string[] | null;

  @Column({ type: 'jsonb' })
  requested_tools!: string[];

  @Column({ type: 'jsonb' })
  effective_tools!: string[];

  @Column({ type: 'jsonb', nullable: true })
  allowed_tools?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  denied_tools?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  assigned_files?: string[] | null;

  @Column({
    type: 'enum',
    enum: DELEGATION_TARGET_TIER_VALUES,
    default: 'heavy',
  })
  target_tier!: DelegationTargetTier;

  @Column({ type: 'integer', nullable: true })
  token_budget?: number | null;

  @Column({ type: 'integer', nullable: true })
  time_budget_ms?: number | null;

  @Column({ type: 'integer', default: 0 })
  max_retries!: number;

  @Column({ type: 'integer', default: 0 })
  attempt_count!: number;

  @Column({ type: 'integer', default: 100 })
  queue_priority!: number;

  @Column({ type: 'jsonb', nullable: true })
  escalation_path?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  expected_artifacts?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  governance_decision?: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: DELEGATION_CONTRACT_STATUS_VALUES,
    default: 'queued',
  })
  status!: DelegationContractStatus;

  @Column({ type: 'timestamptz', nullable: true })
  deadline_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  last_error?: string | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index()
  trace_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  parent_trace_id?: string | null;

  @Column({ type: 'integer', default: 0 })
  lineage_depth!: number;

  @Column({ type: 'jsonb', nullable: true })
  lineage_path?: string[] | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
