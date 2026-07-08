import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { FallbackChainEntry } from '@nexus/core';

@Index('UQ_fallback_chains_name', ['name'], { unique: true })
@Entity('fallback_chains')
export class FallbackChainEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'jsonb', default: [] })
  entries: FallbackChainEntry[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
