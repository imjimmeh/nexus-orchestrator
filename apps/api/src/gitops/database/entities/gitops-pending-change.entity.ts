import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { GitOpsSyncableObjectType } from '@nexus/core';

@Entity('gitops_pending_changes')
export class GitOpsPendingChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'binding_id', type: 'uuid' })
  bindingId: string;

  @Column({ name: 'object_type', type: 'text' })
  objectType: GitOpsSyncableObjectType;

  @Column({ name: 'object_key', type: 'text' })
  objectKey: string;

  @Column({ name: 'scope_node_id', type: 'uuid' })
  scopeNodeId: string;

  @Column({ name: 'change_type', type: 'text' })
  changeType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'base_revision', type: 'text', nullable: true })
  baseRevision: string | null;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
