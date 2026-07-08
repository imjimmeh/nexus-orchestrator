import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { ProviderCooldownReason } from '@nexus/core';

@Index('UQ_provider_cooldowns_provider_name', ['provider_name'], {
  unique: true,
})
@Entity('provider_cooldowns')
export class ProviderCooldown {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  provider_name: string;

  @Column({ type: 'varchar', length: 32 })
  reason: ProviderCooldownReason;

  @Column({ type: 'timestamp' })
  cooled_until: Date;

  @Column({ type: 'timestamp' })
  last_failure_at: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source_run_id?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
