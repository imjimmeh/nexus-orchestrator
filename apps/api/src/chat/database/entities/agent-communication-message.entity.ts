import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AGENT_COMMUNICATION_MESSAGE_KIND_VALUES } from './agent-communication-message.entity.types';
import type { AgentCommunicationMessageKind } from './agent-communication-message.entity.types';

export type { AgentCommunicationMessageKind } from './agent-communication-message.entity.types';

@Entity('agent_communication_messages')
@Index('idx_agent_communication_messages_thread_created', [
  'thread_id',
  'created_at',
])
export class AgentCommunicationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  thread_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'varchar', nullable: true })
  sender_execution_id?: string | null;

  @Column({ type: 'varchar', nullable: true })
  recipient_profile?: string | null;

  @Column({
    type: 'enum',
    enum: AGENT_COMMUNICATION_MESSAGE_KIND_VALUES,
  })
  message_kind!: AgentCommunicationMessageKind;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  correlation_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;
}
