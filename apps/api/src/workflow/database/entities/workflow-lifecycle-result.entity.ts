import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WorkflowLifecycleWorkflowResult } from '@nexus/core';

@Entity('workflow_lifecycle_results')
export class WorkflowLifecycleResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scope_id!: string;

  @Column({ type: 'uuid', nullable: true })
  context_id!: string | null;

  @Column({ type: 'varchar', length: 128 })
  phase!: string;

  @Column({ type: 'varchar', length: 32 })
  hook!: string;

  @Column({ type: 'boolean' })
  blocking_only!: boolean;

  @Column({ type: 'varchar', length: 32 })
  aggregate_status!: string;

  @Column({ type: 'jsonb' })
  results!: WorkflowLifecycleWorkflowResult[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  repository_ref!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
