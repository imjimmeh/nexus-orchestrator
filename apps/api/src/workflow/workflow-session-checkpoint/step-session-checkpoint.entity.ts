import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  HarnessSessionRef,
  SessionCheckpointPhase,
  HarnessId,
} from '@nexus/core';

/**
 * Durable checkpoint recording where an agent session was at a given call
 * boundary within a step turn. Domain-neutral: deals only in execution, run,
 * step, and session identifiers.
 *
 * Each row captures either an `intent` (tool call about to execute) or a
 * `result` (tool call completed), keyed by `(workflow_run_id, step_id,
 * call_seq)`. The supervisor uses `findLatest` / `hasResultFor` to determine
 * whether a step can safely resume from an in-progress execution rather than
 * restart from scratch.
 */
@Entity('step_session_checkpoint')
@Index(['workflow_run_id', 'step_id', 'call_seq'])
export class StepSessionCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  execution_id!: string;

  @Column({ type: 'uuid' })
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'text' })
  step_id!: string;

  @Column({ type: 'varchar', length: 64 })
  engine!: HarnessId;

  @Column({ type: 'jsonb', nullable: true })
  session_ref?: HarnessSessionRef | null;

  @Column({ type: 'text', nullable: true })
  resume_node_id?: string | null;

  @Column({ type: 'text', nullable: true })
  transcript_locator?: string | null;

  @Column({ type: 'varchar', length: 8 })
  phase!: SessionCheckpointPhase;

  @Column({ type: 'int' })
  call_seq!: number;

  @Column({ type: 'text', nullable: true })
  tool_name?: string | null;

  @Column({ type: 'text', nullable: true })
  idempotency_key?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
