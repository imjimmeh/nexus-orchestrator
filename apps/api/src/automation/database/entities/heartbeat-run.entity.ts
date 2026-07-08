import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HeartbeatRunStatus, IHeartbeatRun } from '@nexus/core';

@Entity('heartbeat_runs')
@Index('idx_heartbeat_runs_profile_triggered', [
  'heartbeat_profile_id',
  'triggered_at',
])
@Index('idx_heartbeat_runs_workflow_run', ['workflow_run_id'])
@Index('uq_heartbeat_runs_due_key', ['heartbeat_profile_id', 'due_at'], {
  unique: true,
})
export class HeartbeatRun implements IHeartbeatRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  heartbeat_profile_id: string;

  @Column({
    type: 'enum',
    enum: HeartbeatRunStatus,
    default: HeartbeatRunStatus.TRIGGERED,
  })
  status: HeartbeatRunStatus;

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
