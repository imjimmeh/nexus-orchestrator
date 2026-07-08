import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AgentAwaitStatus,
  HarnessSessionRef,
  SatisfiedChild,
} from '@nexus/core';

/**
 * Durable join record tracking an agent step that is suspended while it awaits
 * the completion of one or more child workflow runs. Domain-neutral: it deals
 * only in run, step, and session identifiers.
 */
@Entity('agent_await')
export class AgentAwaitEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  parent_run_id!: string;

  @Column({ type: 'text' })
  parent_step_id!: string;

  @Column({ type: 'uuid', nullable: true })
  parent_session_tree_id?: string | null;

  @Column({ type: 'jsonb' })
  awaited_run_ids!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  satisfied_run_ids!: SatisfiedChild[];

  @Column({ type: 'varchar', length: 16, default: 'WAITING' })
  status!: AgentAwaitStatus;

  @Column({ type: 'text', nullable: true })
  resume_node_id?: string | null;

  /**
   * Engine-agnostic session reference captured after the parent's suspending
   * turn completes. For Claude Code, `{ kind: 'claude_code', sessionId }` is
   * stored here so the resume path can pass `options.resume` back to the SDK.
   * PI resumes via the session tree (parent_session_tree_id); this field is
   * null for PI awaits.
   */
  @Column({ type: 'jsonb', nullable: true })
  parent_session_ref?: HarnessSessionRef | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
