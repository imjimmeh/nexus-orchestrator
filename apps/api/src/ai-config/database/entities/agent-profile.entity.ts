import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AgentProfileSkill } from './agent-profile-skill.entity';
import type {
  IAgentProfile,
  SkillDiscoveryMode,
  FallbackChainEntry,
  RuntimeToolchainConfig,
} from '@nexus/core';
import type { ToolPolicyDocument, HarnessContributions } from '@nexus/core';

@Index('UQ_agent_profile_name_scope', ['name', 'scope_node_id'], {
  unique: true,
})
@Entity('agent_profiles')
export class AgentProfile implements IAgentProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  system_prompt?: string | null;

  @Column({ type: 'text', nullable: true })
  model_name?: string | null;

  @Column({ type: 'text', nullable: true })
  provider_name?: string | null;

  @Column({ type: 'varchar', nullable: true })
  thinking_level: string | null;

  @Column({ type: 'uuid', nullable: true })
  provider_id?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider_source?: 'global' | 'user' | 'scope' | null;

  @Column({ type: 'text', nullable: true })
  tier_preference?: string | null;

  @Column({
    name: 'supports_vision',
    type: 'boolean',
    default: false,
    nullable: true,
  })
  supports_vision?: boolean | null;

  @Column({ type: 'simple-array', nullable: true })
  allowed_mount_aliases?: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  denied_mount_aliases?: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  allow_rw_mount_aliases?: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  assigned_skills?: string[] | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  skill_discovery_mode?: SkillDiscoveryMode | null;

  @Column({ type: 'varchar', length: 32, default: 'admin' })
  source: 'seeded' | 'admin' | 'agent_factory' | 'repository';

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_profile?: string | null;

  @Column({ type: 'varchar', nullable: true })
  created_by_workflow_run_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  factory_context?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  tool_policy?: ToolPolicyDocument | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  harness_contributions?: Partial<HarnessContributions> | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  fallback_chain?: FallbackChainEntry[] | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  runtime_toolchains?: RuntimeToolchainConfig | null;

  @Column({ default: true })
  is_active: boolean;

  @OneToMany(() => AgentProfileSkill, (assignment) => assignment.agentProfile)
  skillAssignments?: AgentProfileSkill[];

  @Column({
    name: 'scope_node_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  scope_node_id: string | null;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @Column({ type: 'jsonb', nullable: true, default: null })
  overrides: Record<string, unknown> | null;

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

  @Column({ name: 'base_ref', type: 'uuid', nullable: true, default: null })
  base_ref: string | null;

  @Column({
    name: 'base_profile_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  base_profile_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
