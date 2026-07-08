import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AgentProfile } from './agent-profile.entity';
import { AgentSkill } from './agent-skill.entity';

@Entity('agent_profile_skills')
@Unique('uq_agent_profile_skills_profile_skill', ['agentProfileId', 'skillId'])
export class AgentProfileSkill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_profile_id', type: 'uuid' })
  agentProfileId!: string;

  @ManyToOne(() => AgentProfile, (profile) => profile.skillAssignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'agent_profile_id' })
  agentProfile!: AgentProfile;

  @Column({ name: 'skill_id', type: 'uuid' })
  skillId!: string;

  @ManyToOne(() => AgentSkill, (skill) => skill.profileAssignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'skill_id' })
  skill!: AgentSkill;

  @Column({ name: 'assignment_order', type: 'integer', default: 0 })
  assignmentOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
