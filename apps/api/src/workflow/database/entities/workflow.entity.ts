import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IWorkflow } from '@nexus/core';
import type { WorkflowSourceType } from './workflow.entity.types';

@Index('UQ_workflow_name_scope', ['name', 'scope_node_id'], { unique: true })
@Entity('workflows')
export class Workflow implements IWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  yaml_definition: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 32, default: 'user' })
  source_type: WorkflowSourceType;

  @Column({ type: 'uuid', nullable: true })
  scope_id: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  source_path: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  source_ref: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  source_hash: string | null;

  @Column({
    name: 'scope_node_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  scope_node_id: string | null;

  @Column({ type: 'varchar', length: 32, default: 'seeded' })
  source: 'seeded' | 'admin' | 'repository';

  @Column({ name: 'managed_by', type: 'text', nullable: true, default: null })
  managedBy: string | null;

  @Column({
    name: 'managed_binding_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  managedBindingId: string | null;

  @Column({
    name: 'managed_revision',
    type: 'text',
    nullable: true,
    default: null,
  })
  managedRevision: string | null;

  @Column({
    name: 'last_git_hash',
    type: 'text',
    nullable: true,
    default: null,
  })
  lastGitHash: string | null;

  @Column({ name: 'sync_state', type: 'text', nullable: true, default: null })
  syncState: string | null;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @Column({ type: 'jsonb', nullable: true, default: null })
  overrides: Record<string, unknown> | null;

  @Column({ name: 'base_ref', type: 'uuid', nullable: true, default: null })
  base_ref: string | null;

  @Column({
    name: 'base_workflow_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  base_workflow_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
