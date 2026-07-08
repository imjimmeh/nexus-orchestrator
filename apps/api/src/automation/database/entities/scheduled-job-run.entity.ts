import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IScheduledJobRun, ScheduledJobRunStatus } from '@nexus/core';

@Entity('scheduled_job_runs')
@Index('idx_scheduled_job_runs_job_triggered', [
  'scheduled_job_id',
  'triggered_at',
])
@Index('idx_scheduled_job_runs_workflow_run', ['workflow_run_id'])
@Index('uq_scheduled_job_runs_due_key', ['scheduled_job_id', 'due_at'], {
  unique: true,
})
export class ScheduledJobRun implements IScheduledJobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  scheduled_job_id: string;

  @Column({
    type: 'enum',
    enum: ScheduledJobRunStatus,
    default: ScheduledJobRunStatus.TRIGGERED,
  })
  status: ScheduledJobRunStatus;

  @Column({ type: 'timestamptz' })
  due_at: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  triggered_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  workflow_run_id?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  error_code?: string | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  diagnostics_json?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
