import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PluginIsolationMode,
  PluginLifecycleState,
  PluginSourceType,
  PluginTrustLevel,
} from './plugin-registry-entry.types';

@Entity('plugin_registry_entries')
@Check(
  'chk_plugin_registry_entries_source_type',
  "source_type IN ('package', 'local', 'bundled')",
)
@Check(
  'chk_plugin_registry_entries_lifecycle_state',
  "lifecycle_state IN ('discovered', 'installed', 'scanned', 'enabled', 'disabled', 'quarantined', 'uninstalled')",
)
@Check(
  'chk_plugin_registry_entries_trust_level',
  "trust_level IN ('bundled', 'local_trusted', 'third_party', 'quarantined')",
)
@Check(
  'chk_plugin_registry_entries_isolation_mode',
  "isolation_mode IN ('none', 'worker_process', 'container')",
)
@Index('uq_plugin_registry_entries_plugin_version', ['plugin_id', 'version'], {
  unique: true,
})
@Index('idx_plugin_registry_entries_lifecycle_state', ['lifecycle_state'])
@Index('idx_plugin_registry_entries_enabled', ['enabled'])
@Index('idx_plugin_registry_entries_trust_level', ['trust_level'])
@Index('idx_plugin_registry_entries_isolation_mode', ['isolation_mode'])
@Index('idx_plugin_registry_entries_active_lookup', [
  'lifecycle_state',
  'plugin_id',
  'version',
])
export class PluginRegistryEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  plugin_id!: string;

  @Column({ type: 'varchar', length: 64 })
  version!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  author!: string | null;

  @Column({ type: 'varchar', length: 32 })
  source_type!: PluginSourceType;

  @Column({ type: 'text' })
  source!: string;

  @Column({ type: 'varchar', length: 32 })
  lifecycle_state!: PluginLifecycleState;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 32 })
  trust_level!: PluginTrustLevel;

  @Column({ type: 'varchar', length: 32 })
  isolation_mode!: PluginIsolationMode;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  requested_permissions!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  granted_permissions!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', nullable: true })
  scan_result!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  compatibility_result!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  contributions!: Array<Record<string, unknown>>;

  @Column({ type: 'text', nullable: true })
  last_error!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  installed_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  scanned_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  enabled_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  disabled_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  quarantined_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  uninstalled_at!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
