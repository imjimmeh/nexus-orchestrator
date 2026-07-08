import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CHAT_SESSION_PARTICIPANT_ROLE_VALUES,
  CHAT_SESSION_PARTICIPATION_STATUS_VALUES,
  type ChatSessionParticipantRole,
  type ChatSessionParticipationStatus,
} from './chat-session-participant.entity.types';

@Entity('chat_session_participants')
@Index(
  'idx_chat_session_participants_session_agent_unique',
  ['chat_session_id', 'agent_profile'],
  {
    unique: true,
  },
)
export class ChatSessionParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  chat_session_id!: string;

  @Column()
  @Index()
  agent_profile!: string;

  @Column({
    type: 'enum',
    enum: CHAT_SESSION_PARTICIPANT_ROLE_VALUES,
    enumName: 'chat_session_participant_role_enum',
  })
  role!: ChatSessionParticipantRole;

  @Column({
    type: 'enum',
    enum: CHAT_SESSION_PARTICIPATION_STATUS_VALUES,
    enumName: 'chat_session_participation_status_enum',
    default: 'invited',
  })
  participation_status!: ChatSessionParticipationStatus;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  invited_by?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  joined_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  left_at?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
