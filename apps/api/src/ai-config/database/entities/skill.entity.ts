import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('skills')
@Index('UQ_skill_name_scope', ['name', 'scope_node_id'], { unique: true })
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'skill_markdown', type: 'text', default: '' })
  skill_markdown!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  category?: string | null;

  @Column({ type: 'simple-array', nullable: true })
  tags?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ name: 'scope_node_id', type: 'uuid', nullable: true })
  scope_node_id: string | null = null;

  @Column({ type: 'varchar', length: 32, default: 'admin' })
  source!: 'imported' | 'admin' | 'agent_factory' | 'repository';

  @Column({ type: 'boolean', default: false })
  locked!: boolean;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'jsonb', nullable: true, default: null })
  overrides?: Record<string, unknown> | null;

  @Column({ name: 'managed_by', type: 'text', nullable: true, default: null })
  managedBy?: string | null;

  @Column({
    name: 'managed_binding_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  managedBindingId?: string | null;

  @Column({
    name: 'managed_revision',
    type: 'text',
    nullable: true,
    default: null,
  })
  managedRevision?: string | null;

  @Column({
    name: 'last_git_hash',
    type: 'text',
    nullable: true,
    default: null,
  })
  lastGitHash?: string | null;

  @Column({ name: 'sync_state', type: 'text', nullable: true, default: null })
  syncState?: string | null;

  @Column({ name: 'base_ref', type: 'uuid', nullable: true, default: null })
  base_ref?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
