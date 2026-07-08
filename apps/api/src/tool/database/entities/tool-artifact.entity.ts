import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { IToolArtifact } from '@nexus/core';

@Entity('tool_artifacts')
@Index(['tool_name', 'version'], { unique: true })
export class ToolArtifact implements IToolArtifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  tool_name: string;

  @Column({ type: 'varchar', length: 16, default: 'node' })
  language: IToolArtifact['language'];

  @Column({ type: 'text' })
  source_code: string;

  @Column({ type: 'text', nullable: true })
  test_spec?: string | null;

  @Column({ type: 'jsonb' })
  schema: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64 })
  checksum: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  @Index()
  status: IToolArtifact['status'];

  @Column({ type: 'uuid', nullable: true })
  latest_validation_run_id?: string | null;

  @Column({ type: 'boolean', default: false })
  @Index()
  is_active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  validated_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
