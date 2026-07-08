import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the `harness_assets` table (EPIC-211 Phase 1).
 *
 * Rows are immutable content-addressed asset records (plugin, extension, or
 * hook_script). The table has no `updated_at` column — the repository
 * intentionally exposes no update path.
 *
 * Indexes on `kind` and `scope_node_id` support the two primary read patterns:
 * listing assets by type and listing assets visible to a scope.
 */
export class CreateHarnessAssets20260630000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS harness_assets (
        "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),
        "kind"          varchar(32) NOT NULL,
        "name"          varchar(200) NOT NULL,
        "version"       varchar(64)  NOT NULL,
        "source"        jsonb        NOT NULL,
        "checksum"      varchar(128) NOT NULL,
        "bundle"        text         NOT NULL,
        "scope_node_id" varchar(200),
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_harness_assets_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_harness_assets_kind"
        ON harness_assets ("kind");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_harness_assets_scope_node_id"
        ON harness_assets ("scope_node_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS harness_assets;`);
  }
}
