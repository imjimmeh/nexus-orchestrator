import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AGENT_WAR_ROOM_MESSAGE_KIND_VALUES } from './agent-war-room-message.entity.types';
import type { AgentWarRoomMessageKind } from './agent-war-room-message.entity.types';

export type { AgentWarRoomMessageKind } from './agent-war-room-message.entity.types';

@Entity('agent_war_room_messages')
@Index('idx_agent_war_room_messages_session_created', [
  'session_id',
  'created_at',
])
export class AgentWarRoomMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  session_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'varchar', nullable: true })
  sender_execution_id?: string | null;

  @Column({ type: 'varchar', nullable: true })
  sender_profile?: string | null;

  @Column({
    type: 'enum',
    enum: AGENT_WAR_ROOM_MESSAGE_KIND_VALUES,
    enumName: 'agent_war_room_message_kind_enum',
  })
  message_kind!: AgentWarRoomMessageKind;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;
}
