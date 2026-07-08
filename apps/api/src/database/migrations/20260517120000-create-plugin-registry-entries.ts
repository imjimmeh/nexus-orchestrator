import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePluginRegistryEntries20260517120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plugin_registry_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_id character varying(255) NOT NULL,
        version character varying(64) NOT NULL,
        name character varying(255) NOT NULL,
        description text,
        author character varying(255),
        source_type character varying(32) NOT NULL,
        source text NOT NULL,
        lifecycle_state character varying(32) NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        trust_level character varying(32) NOT NULL,
        isolation_mode character varying(32) NOT NULL,
        requested_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
        granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
        scan_result jsonb,
        compatibility_result jsonb,
        contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
        last_error text,
        installed_at timestamptz,
        scanned_at timestamptz,
        enabled_at timestamptz,
        disabled_at timestamptz,
        quarantined_at timestamptz,
        uninstalled_at timestamptz,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_plugin_registry_entries_source_type
          CHECK (source_type IN ('package', 'local', 'bundled')),
        CONSTRAINT chk_plugin_registry_entries_lifecycle_state
          CHECK (lifecycle_state IN ('discovered', 'installed', 'scanned', 'enabled', 'disabled', 'quarantined', 'uninstalled')),
        CONSTRAINT chk_plugin_registry_entries_trust_level
          CHECK (trust_level IN ('bundled', 'local_trusted', 'third_party', 'quarantined')),
        CONSTRAINT chk_plugin_registry_entries_isolation_mode
          CHECK (isolation_mode IN ('none', 'worker_process', 'container'))
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_plugin_registry_entries_plugin_version
      ON plugin_registry_entries(plugin_id, version);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_entries_lifecycle_state
      ON plugin_registry_entries(lifecycle_state);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_entries_enabled
      ON plugin_registry_entries(enabled);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_entries_trust_level
      ON plugin_registry_entries(trust_level);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_entries_isolation_mode
      ON plugin_registry_entries(isolation_mode);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_entries_active_lookup
      ON plugin_registry_entries(lifecycle_state, plugin_id, version);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS plugin_registry_entries');
  }
}
