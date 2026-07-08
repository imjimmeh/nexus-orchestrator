import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ScheduledJobScope as ScheduledJobScopeValue,
  IScheduledJob,
  ScheduledJobStatus,
  ScheduledJobTargetType,
  ScheduledJobType,
} from '@nexus/core';
import type { ScheduledJobScope } from '@nexus/core';

const SCHEDULED_JOB_SCOPE_VALUES = ['scope', 'global'] as const;

@Entity('scheduled_jobs')
@Index('idx_scheduled_jobs_scope_status_next_run', [
  'schedule_scope',
  'status',
  'next_run_at',
])
@Index('idx_scheduled_jobs_scope_status_next_run', [
  'scopeId',
  'status',
  'next_run_at',
])
@Index('idx_scheduled_jobs_status_next_run', ['status', 'next_run_at'])
export class ScheduledJob implements IScheduledJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: SCHEDULED_JOB_SCOPE_VALUES,
    default: ScheduledJobScopeValue.SCOPE,
  })
  schedule_scope: ScheduledJobScope;

  @Column({ name: 'scope_id', type: 'uuid', nullable: true })
  scopeId?: string | null;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({
    type: 'enum',
    enum: ScheduledJobStatus,
    default: ScheduledJobStatus.ACTIVE,
  })
  status: ScheduledJobStatus;

  @Column({
    type: 'enum',
    enum: ScheduledJobType,
  })
  schedule_type: ScheduledJobType;

  @Column({ type: 'text' })
  schedule_expression: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  timezone?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_run_at?: Date | null;

  @Column({
    type: 'enum',
    enum: ScheduledJobTargetType,
    default: ScheduledJobTargetType.WORKFLOW,
  })
  execution_target_type: ScheduledJobTargetType;

  @Column({ type: 'uuid' })
  execution_target_ref: string;

  @Column({ type: 'jsonb', default: {} })
  payload_json: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paused_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
