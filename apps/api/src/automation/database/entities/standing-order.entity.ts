import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IStandingOrder, StandingOrderOverridePolicy } from '@nexus/core';

@Entity('standing_orders')
@Index('idx_standing_orders_scope_enabled_priority', [
  'scopeId',
  'enabled',
  'priority',
])
@Index('idx_standing_orders_scope_profile', ['scopeId', 'profile_name'])
export class StandingOrder implements IStandingOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId: string;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'text' })
  instruction: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  profile_name?: string | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({
    type: 'enum',
    enum: StandingOrderOverridePolicy,
    default: StandingOrderOverridePolicy.ADVISORY,
  })
  override_policy: StandingOrderOverridePolicy;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
