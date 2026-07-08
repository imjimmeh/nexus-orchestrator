import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IWorkflowRun, WorkflowStatus } from '@nexus/core';
import type { WaitReason } from '@nexus/core';

@Entity('workflow_runs')
export class WorkflowRun implements IWorkflowRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  workflow_id: string;

  @Column({
    type: 'enum',
    enum: WorkflowStatus,
    default: WorkflowStatus.PENDING,
  })
  status: WorkflowStatus;

  @Column({ nullable: true })
  current_step_id?: string;

  @Column({ type: 'jsonb', default: {} })
  state_variables: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  awaiting_input: boolean;

  @Column({ type: 'varchar', length: 16, nullable: true, default: null })
  wait_reason?: WaitReason | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  @Index()
  concurrency_scope?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  @Index()
  launch_dedupe_key?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completed_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ── Domain: status management ───────────────────────────────────────────────

  /**
   * Updates the run status in-memory. Persist the entity after calling this.
   */
  updateStatus(status: WorkflowStatus): void {
    this.status = status;
  }

  // ── Domain: state_variables management ─────────────────────────────────────

  /**
   * Sets a top-level key in `state_variables` in-memory.
   * For atomic DB-level persistence, prefer StateManagerService.setVariable().
   */
  setStateVariable(key: string, value: unknown): void {
    this.state_variables = { ...this.state_variables, [key]: value };
  }
}
