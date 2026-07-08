import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IToolRegistry } from '@nexus/core';
import type { IToolApiCallback } from '@nexus/core';

@Entity('tool_registry')
export class ToolRegistry implements IToolRegistry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'jsonb' })
  schema: Record<string, unknown>;

  @Column({ type: 'text' })
  typescript_code: string;

  @Column({ type: 'int', default: 0 })
  tier_restriction: number;

  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source: IToolRegistry['source'];

  @Column({ type: 'varchar', length: 16, nullable: true })
  runtime_owner?: IToolRegistry['runtime_owner'];

  @Column({ type: 'varchar', length: 32, nullable: true })
  transport?: IToolRegistry['transport'];

  @Column({ type: 'jsonb', nullable: true })
  api_callback?: IToolApiCallback | boolean | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: IToolRegistry['language'];

  @Column({ type: 'varchar', length: 32, nullable: true })
  publication_status?: IToolRegistry['publication_status'];

  @Column({ type: 'uuid', nullable: true })
  mcp_server_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  published_artifact_id?: string | null;

  @Column({ type: 'int', nullable: true })
  published_version?: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
