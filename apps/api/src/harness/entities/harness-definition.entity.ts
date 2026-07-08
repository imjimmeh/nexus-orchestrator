import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { HarnessCapabilities } from '@nexus/core';

@Entity({ name: 'harness_definition' })
export class HarnessDefinitionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Index({ unique: true })
  @Column({ name: 'harness_id', type: 'text' })
  harnessId!: string;

  @Column({ name: 'display_name', type: 'text' }) displayName!: string;

  @Column({ type: 'text' }) source!: 'builtin' | 'custom';

  @Column({ type: 'jsonb' }) capabilities!: HarnessCapabilities;

  @Column({ name: 'image_ref', type: 'text' }) imageRef!: string;

  @Column({ type: 'text' }) transport!: 'kernel' | 'external';

  @Column({ name: 'endpoint_config', type: 'jsonb', nullable: true })
  endpointConfig!: Record<string, unknown> | null;

  @Column({ name: 'default_env', type: 'jsonb', default: {} })
  defaultEnv!: Record<string, string>;

  @Column({ type: 'boolean', default: true }) enabled!: boolean;

  @Column({ name: 'policy_scope', type: 'jsonb', default: {} })
  policyScope!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
