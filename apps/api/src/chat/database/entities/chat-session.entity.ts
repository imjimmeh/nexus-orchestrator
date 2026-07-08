import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  type ChatSessionExecutionState,
  type ChatSessionFailureInfo,
  ChatSessionSource,
  ChatSessionStatus,
  type ChatSessionRetryMetadata,
  ChatSessionType,
} from '@nexus/core';

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, default: ChatSessionStatus.STARTING })
  @Index()
  status: ChatSessionStatus;

  @Column({ type: 'varchar', length: 32, default: 'starting' })
  @Index()
  execution_state: ChatSessionExecutionState;

  @Column({ type: 'jsonb', nullable: true })
  retry_metadata?: ChatSessionRetryMetadata | null;

  @Column({ type: 'jsonb', nullable: true })
  failure_info?: ChatSessionFailureInfo | null;

  @Column({ type: 'varchar', length: 20, default: ChatSessionType.GENERAL })
  @Index()
  session_type: ChatSessionType;

  @Column({ type: 'uuid' })
  @Index()
  agent_profile_id: string;

  @Column({ type: 'varchar', length: 255 })
  agent_profile_name: string;

  @Column({ name: 'scope_id', type: 'uuid', nullable: true })
  @Index()
  scopeId?: string | null;

  @Column({ type: 'text' })
  initial_message: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  display_name?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  container_id?: string | null;

  @Column({ type: 'smallint', default: 2 })
  container_tier: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model?: string | null;

  @Column({ type: 'text', nullable: true })
  system_prompt?: string | null;

  @Column({ type: 'uuid', nullable: true })
  session_tree_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  workflow_run_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  parent_chat_session_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  execution_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  subagent_execution_id?: string | null;

  @Column({ type: 'text', nullable: true })
  error_message?: string | null;

  @Column({ type: 'varchar', length: 64, default: ChatSessionSource.AD_HOC })
  @Index()
  source: ChatSessionSource;

  /**
   * Runner harness the session executed on (e.g. `pi`, `claude-code`).
   * Persisted so a failed session's runtime is recoverable from the database.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  harness_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  context_metadata?: {
    injected_at: Date;
    providers_used: string[];
    block_count: number;
    version: string;
  } | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date | null;
}
