import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES,
  AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES,
} from './agent-war-room-participant.entity.types';
import type {
  AgentWarRoomParticipantRole,
  AgentWarRoomParticipationStatus,
} from './agent-war-room-participant.entity.types';

export type {
  AgentWarRoomParticipantRole,
  AgentWarRoomParticipationStatus,
} from './agent-war-room-participant.entity.types';

@Entity('agent_war_room_participants')
@Index(
  'idx_agent_war_room_participants_session_agent_unique',
  ['session_id', 'agent_profile'],
  {
    unique: true,
  },
)
export class AgentWarRoomParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  session_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column()
  @Index()
  agent_profile!: string;

  @Column({ type: 'varchar', nullable: true })
  execution_id?: string | null;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES,
    enumName: 'agent_war_room_participant_role_enum',
  })
  role!: AgentWarRoomParticipantRole;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES,
    enumName: 'agent_war_room_participation_status_enum',
    default: 'invited',
  })
  participation_status!: AgentWarRoomParticipationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  joined_at?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
