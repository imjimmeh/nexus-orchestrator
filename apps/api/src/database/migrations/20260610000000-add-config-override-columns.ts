import { MigrationInterface, QueryRunner } from 'typeorm';

const CONFIG_TABLES = ['workflows', 'agent_profiles'] as const;

export class AddConfigOverrideColumns20260610000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // workflows lacks `source`; agent_profiles already has `source`.
    await queryRunner.query(`
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS scope_node_id uuid NULL REFERENCES scope_nodes(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS source character varying(32) NOT NULL DEFAULT 'seeded',
        ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS overrides jsonb NULL,
        ADD COLUMN IF NOT EXISTS base_ref uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS scope_node_id uuid NULL REFERENCES scope_nodes(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS overrides jsonb NULL,
        ADD COLUMN IF NOT EXISTS base_ref uuid NULL
    `);

    for (const table of CONFIG_TABLES) {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "idx_${table}_name_scope" ON ${table} (name, scope_node_id)`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${table}_default_name"
           ON ${table} (name) WHERE scope_node_id IS NULL`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${table}_scoped_name"
           ON ${table} (name, scope_node_id) WHERE scope_node_id IS NOT NULL`,
      );
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = '${table}'::regclass AND conname = 'chk_${table}_overrides_jsonb'
          ) THEN
            ALTER TABLE ${table}
              ADD CONSTRAINT chk_${table}_overrides_jsonb
              CHECK (overrides IS NULL OR jsonb_typeof(overrides) = 'object');
          END IF;
        END $$
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.guardNoScopedRows(queryRunner);
    for (const table of CONFIG_TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "uq_${table}_scoped_name"`);
      await queryRunner.query(
        `DROP INDEX IF EXISTS "uq_${table}_default_name"`,
      );
      await queryRunner.query(`DROP INDEX IF EXISTS "idx_${table}_name_scope"`);
      await queryRunner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_overrides_jsonb`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS base_ref`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS overrides`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS locked`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS scope_node_id`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE workflows DROP COLUMN IF EXISTS source`,
    );
  }

  private async guardNoScopedRows(queryRunner: QueryRunner): Promise<void> {
    for (const table of CONFIG_TABLES) {
      const rows = (await queryRunner.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE scope_node_id IS NOT NULL`,
      )) as Array<{ count: number }>;
      if ((rows[0]?.count ?? 0) > 0) {
        throw new Error(
          `Rollback unsafe: ${rows[0].count} scoped row(s) in ${table}. Remove per-scope overrides before rolling back.`,
        );
      }
    }
  }
}
