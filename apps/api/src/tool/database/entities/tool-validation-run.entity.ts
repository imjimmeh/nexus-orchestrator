import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { IToolValidationRun } from '@nexus/core';

@Entity('tool_validation_runs')
export class ToolValidationRun implements IToolValidationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  artifact_id: string;

  @Column({ type: 'varchar', length: 255 })
  sandbox_image: string;

  @Column({ type: 'varchar', length: 32 })
  @Index()
  status: IToolValidationRun['status'];

  @Column({ type: 'int', nullable: true })
  exit_code?: number | null;

  @Column({ type: 'text', nullable: true })
  stdout?: string | null;

  @Column({ type: 'text', nullable: true })
  stderr?: string | null;

  @Column({ type: 'int', nullable: true })
  duration_ms?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  policy_denials?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
