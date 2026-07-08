import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import type {
  ExecutionFailureReason,
  ExecutionKind,
  ExecutionState,
} from '../../execution-lifecycle.contracts';

@Entity('executions')
@Index(['state'])
@Index(['kind', 'state'])
@Index(['state', 'last_heartbeat_at'])
@Index(['state', 'owner_lease_expires_at'])
@Index(['workflow_run_id'])
@Index(['chat_session_id'])
@Index(['frozen'])
export class ExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: ExecutionKind;

  @Column({ type: 'uuid', nullable: true })
  parent_execution_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  workflow_run_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  chat_session_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  scope_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  context_id?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  container_id?: string | null;

  @Column({ type: 'smallint', default: 2 })
  container_tier!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model?: string | null;

  @Column({ type: 'uuid', nullable: true })
  agent_profile_id?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  agent_profile_name?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  harness_id?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider_source?: string | null;

  @Column({ type: 'bigint', nullable: true })
  input_tokens?: number | null;

  @Column({ type: 'bigint', nullable: true })
  output_tokens?: number | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  state!: ExecutionState;

  @Column({ type: 'varchar', length: 48, nullable: true })
  failure_reason?: ExecutionFailureReason | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  last_heartbeat_at?: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  owner_instance_id?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  owner_lease_expires_at?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_progress_at?: Date | null;

  @Column({ type: 'int', default: 0 })
  attempt!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  terminal_at?: Date | null;

  @Column({ type: 'boolean', default: false })
  frozen!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  paused_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  pause_reason?: string | null;

  @VersionColumn()
  version!: number;
}
