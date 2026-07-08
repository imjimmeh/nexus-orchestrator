import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScopeNodeType } from '../../scope.constants';

@Entity('scope_nodes')
@Index('idx_scope_nodes_parent', ['parentId'])
export class ScopeNode {
  // PrimaryColumn (not generated) — callers pre-mint IDs so the global root
  // (GLOBAL_SCOPE_NODE_ID) can have a fixed well-known UUID.
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 32 })
  type: ScopeNodeType;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255 })
  slug: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'is_tenant_root', type: 'boolean', default: false })
  isTenantRoot: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
