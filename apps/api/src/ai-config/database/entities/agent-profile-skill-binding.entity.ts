import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Runtime skill -> (scope_node | scope_node + agent_profile) assignment.
 * `agent_profile_id: null` means the binding applies to any agent profile
 * operating under `scope_node_id` (the "project" tier); a non-null
 * `agent_profile_id` restricts it to that one profile (the "project+agent"
 * tier). The true uniqueness constraint on
 * `(COALESCE(agent_profile_id, '00000000-...-000000'), scope_node_id, skill_name)`
 * is an expression index created in the migration
 * (`apps/api/src/database/migrations/20260714040000-create-agent-profile-skill-bindings.ts`)
 * — TypeORM's `@Index`/`@Unique` decorators cannot express a `COALESCE`
 * expression, so it is intentionally not mirrored here (same discipline as
 * `WorkflowSkillBinding`).
 */
@Entity('agent_profile_skill_bindings')
@Index('idx_agent_profile_skill_bindings_scope_node', ['scope_node_id'])
export class AgentProfileSkillBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_profile_id', type: 'uuid', nullable: true })
  agent_profile_id!: string | null;

  @Column({ name: 'scope_node_id', type: 'uuid' })
  scope_node_id!: string;

  @Column({ name: 'skill_name', type: 'varchar', length: 64 })
  skill_name!: string;

  @Column({ type: 'jsonb', nullable: true })
  provenance!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}
