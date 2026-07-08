import { MigrationInterface, QueryRunner } from 'typeorm';

const RECONCILED_TABLES = [
  'scope_nodes',
  'roles',
  'role_assignments',
  'scope_config_overrides',
];

export class AddManagedByTag20260612000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of RECONCILED_TABLES) {
      const exists = (await queryRunner.query(`SELECT to_regclass($1) AS t`, [
        table,
      ])) as Array<{ t: string | null }>;
      if (!exists[0]?.t) continue;
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS managed_by varchar(32) NULL;`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of RECONCILED_TABLES) {
      const exists = (await queryRunner.query(`SELECT to_regclass($1) AS t`, [
        table,
      ])) as Array<{ t: string | null }>;
      if (!exists[0]?.t) continue;
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS managed_by;`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DROP COLUMN IF EXISTS locked;`,
      );
    }
  }
}
