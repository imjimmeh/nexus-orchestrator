import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { DoctorRepairHistoryStatus } from './doctor-repair-history.entity.types';

@Entity('doctor_repair_history')
@Index('idx_doctor_repair_history_action', ['action_id'])
@Index('idx_doctor_repair_history_status', ['status'])
@Index('idx_doctor_repair_history_started_at', ['started_at'])
export class DoctorRepairHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  action_id: string;

  @Column({ type: 'varchar', length: 32 })
  status: DoctorRepairHistoryStatus;

  @Column({ type: 'boolean', default: false })
  dry_run: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requested_by?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  input_json?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  result_json?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence_json?: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
