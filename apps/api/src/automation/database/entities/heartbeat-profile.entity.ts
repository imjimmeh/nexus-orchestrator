import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IHeartbeatProfile } from '@nexus/core';

@Entity('heartbeat_profiles')
@Index('idx_heartbeat_profiles_scope_enabled_next_run', [
  'scopeId',
  'enabled',
  'next_run_at',
])
@Index('idx_heartbeat_profiles_workflow', ['workflow_id'])
export class HeartbeatProfile implements IHeartbeatProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId: string;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int' })
  interval_seconds: number;

  @Column({ type: 'uuid' })
  workflow_id: string;

  @Column({ type: 'jsonb', default: {} })
  payload_json: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  next_run_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_run_at?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
