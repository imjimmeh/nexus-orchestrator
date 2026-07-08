import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { HarnessAssetSource } from '@nexus/core';
import type { HarnessAssetKind } from './harness-asset.types';

/**
 * Immutable content-addressed asset record.
 *
 * Rows are write-once: the repository exposes create + read methods only.
 * A new version of the same logical asset gets a new row with a new id.
 */
@Entity('harness_assets')
@Index('idx_harness_assets_kind', ['kind'])
@Index('idx_harness_assets_scope_node_id', ['scopeNodeId'])
export class HarnessAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  kind: HarnessAssetKind;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  version: string;

  /** Provenance descriptor — which source produced this asset. */
  @Column({ type: 'jsonb' })
  source: HarnessAssetSource;

  /** Content-hash of the bundle (e.g. `sha256:<hex>`). */
  @Column({ type: 'varchar', length: 128 })
  checksum: string;

  /**
   * Inline asset payload. Stored as text for script/source-code assets;
   * an object-store reference is a later option.
   */
  @Column({ type: 'text' })
  bundle: string;

  /**
   * Owning scope node. `null` means the asset is platform-global and
   * available to all scopes.
   */
  @Column({
    name: 'scope_node_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  scopeNodeId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
