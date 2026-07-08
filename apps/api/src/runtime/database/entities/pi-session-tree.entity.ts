import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IPiSessionTree } from '@nexus/core';

@Entity('pi_session_trees')
export class PiSessionTree implements IPiSessionTree {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  workflow_run_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  chat_session_id?: string | null;

  @Column({ type: 'int' })
  container_tier: number;

  @Column({ type: 'jsonb', default: [] })
  jsonl_data: unknown[];

  @Column({ nullable: true })
  last_leaf_node_id?: string;

  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  archived_at?: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  archive_reason?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
