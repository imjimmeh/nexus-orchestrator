import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AGENT_COMMUNICATION_THREAD_STATUS_VALUES,
  AGENT_COMMUNICATION_THREAD_URGENCY_VALUES,
} from './agent-communication-thread.entity.types';
import type {
  AgentCommunicationThreadStatus,
  AgentCommunicationThreadUrgency,
} from './agent-communication-thread.entity.types';

export type {
  AgentCommunicationThreadStatus,
  AgentCommunicationThreadUrgency,
} from './agent-communication-thread.entity.types';

@Entity('agent_communication_threads')
@Index('idx_agent_communication_threads_run_requester', [
  'workflow_run_id',
  'requester_execution_id',
])
export class AgentCommunicationThread {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  thread_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({ name: 'scope_id', type: 'varchar', nullable: true })
  @Index()
  scopeId?: string | null;

  @Column({ name: 'context_id', type: 'varchar', nullable: true })
  @Index()
  contextId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  requester_execution_id?: string | null;

  @Column()
  target_agent_profile!: string;

  @Column({
    type: 'enum',
    enum: AGENT_COMMUNICATION_THREAD_URGENCY_VALUES,
    default: 'normal',
  })
  urgency!: AgentCommunicationThreadUrgency;

  @Column({
    type: 'enum',
    enum: AGENT_COMMUNICATION_THREAD_STATUS_VALUES,
    default: 'open',
  })
  status!: AgentCommunicationThreadStatus;

  @Column({ type: 'int', default: 0 })
  message_count!: number;

  @Column({ type: 'varchar', nullable: true })
  correlation_id?: string | null;

  @Column({ type: 'text', nullable: true })
  resolution_note?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_message_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at?: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
