import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES } from './agent-war-room-participant.entity.types';
import { AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES } from './agent-war-room-signoff.entity.types';
import type { AgentWarRoomParticipantRole } from './agent-war-room-participant.entity.types';
import type { AgentWarRoomSignoffDecision } from './agent-war-room-signoff.entity.types';

export type { AgentWarRoomSignoffDecision } from './agent-war-room-signoff.entity.types';

@Entity('agent_war_room_signoffs')
@Index(
  'idx_agent_war_room_signoffs_session_role_agent_unique',
  ['session_id', 'role', 'agent_profile'],
  {
    unique: true,
  },
)
export class AgentWarRoomSignoff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  session_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES,
    enumName: 'agent_war_room_participant_role_enum',
  })
  role!: AgentWarRoomParticipantRole;

  @Column()
  @Index()
  agent_profile!: string;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES,
    enumName: 'agent_war_room_signoff_decision_enum',
  })
  decision!: AgentWarRoomSignoffDecision;

  @Column({ type: 'text', nullable: true })
  rationale?: string | null;

  @Column({ type: 'varchar', nullable: true })
  submitted_by_execution_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
