import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AgentProfileSkill } from './agent-profile-skill.entity';

@Entity('agent_skills')
@Unique('uq_agent_skills_name', ['name'])
export class AgentSkill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'varchar', length: 1024 })
  description!: string;

  @Column({ name: 'skill_markdown', type: 'text' })
  skillMarkdown!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  compatibility?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32, default: 'admin' })
  source!: 'admin' | 'agent_factory' | 'imported';

  @Column({
    name: 'created_by_profile',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  createdByProfile?: string | null;

  @Column({
    name: 'created_by_workflow_run_id',
    type: 'varchar',
    nullable: true,
  })
  createdByWorkflowRunId?: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => AgentProfileSkill, (assignment) => assignment.skill)
  profileAssignments?: AgentProfileSkill[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
