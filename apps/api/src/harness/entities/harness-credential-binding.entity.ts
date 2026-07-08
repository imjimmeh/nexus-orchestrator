import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { HarnessAuthType } from '@nexus/core';

@Entity({ name: 'harness_credential_binding' })
@Index(
  'harness_credential_binding_scope_harness_key_idx',
  ['scopeNodeId', 'harnessId', 'credentialKey'],
  { unique: true },
)
export class HarnessCredentialBindingEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'scope_node_id', type: 'uuid', nullable: true })
  scopeNodeId!: string | null;

  @Column({ name: 'harness_id', type: 'text' }) harnessId!: string;

  @Column({ name: 'credential_key', type: 'text' }) credentialKey!: string;

  @Column({ name: 'auth_type', type: 'text' }) authType!: HarnessAuthType;

  @Column({ name: 'secret_id', type: 'uuid' }) secretId!: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
