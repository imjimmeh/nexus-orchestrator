import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AGENT_WAR_ROOM_CONSENSUS_STATE_VALUES,
  AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES,
  AGENT_WAR_ROOM_SESSION_STATUS_VALUES,
} from './agent-war-room-session.entity.types';
import type {
  AgentWarRoomConsensusState,
  AgentWarRoomResolutionType,
  AgentWarRoomSessionStatus,
} from './agent-war-room-session.entity.types';

export type {
  AgentWarRoomConsensusState,
  AgentWarRoomResolutionType,
  AgentWarRoomSessionStatus,
} from './agent-war-room-session.entity.types';

@Entity('agent_war_room_sessions')
@Index('idx_agent_war_room_sessions_workflow_run', ['workflow_run_id'])
export class AgentWarRoomSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  session_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  scope_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  context_id?: string | null;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_SESSION_STATUS_VALUES,
    enumName: 'agent_war_room_session_status_enum',
    default: 'open',
  })
  status!: AgentWarRoomSessionStatus;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_CONSENSUS_STATE_VALUES,
    enumName: 'agent_war_room_consensus_state_enum',
    default: 'collecting_input',
  })
  consensus_state!: AgentWarRoomConsensusState;

  @Column({ type: 'varchar', nullable: true })
  created_by_execution_id?: string | null;

  @Column({ default: 'ceo-agent' })
  moderator_profile!: string;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES,
    enumName: 'agent_war_room_resolution_type_enum',
    nullable: true,
  })
  resolution_type?: AgentWarRoomResolutionType | null;

  @Column({ type: 'text', nullable: true })
  resolution_note?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  opened_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at?: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
