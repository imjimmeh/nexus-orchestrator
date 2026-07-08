import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  BrowserAutomationActionType,
  IBrowserAutomationActionRequest,
  IBrowserAutomationAttemptTrace,
  IBrowserSelectorTrace,
  IWebAutomationFailureArtifact,
} from '@nexus/core';

@Entity('web_automation_failure_artifacts')
@Index(['workflow_run_id', 'created_at'])
export class WebAutomationFailureArtifact implements IWebAutomationFailureArtifact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  step_id!: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  action_name!: BrowserAutomationActionType;

  @Column({ type: 'jsonb' })
  action_payload!: IBrowserAutomationActionRequest | Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  selector_trace?: IBrowserSelectorTrace | null;

  @Column({ type: 'jsonb' })
  attempts!: IBrowserAutomationAttemptTrace[];

  @Column({ type: 'int' })
  attempt_count!: number;

  @Column({ type: 'int' })
  duration_ms!: number;

  @Column({ type: 'text' })
  error_message!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  dom_snapshot_hash?: string | null;

  @Column({ type: 'text', nullable: true })
  dom_snapshot?: string | null;

  @Column({ type: 'text', nullable: true })
  screenshot_base64?: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
