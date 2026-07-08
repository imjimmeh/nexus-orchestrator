import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionFreezeColumns20260622000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS paused_at timestamp,
        ADD COLUMN IF NOT EXISTS pause_reason text;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_executions_frozen" ON executions (frozen);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_executions_frozen";
    `);
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS frozen,
        DROP COLUMN IF EXISTS paused_at,
        DROP COLUMN IF EXISTS pause_reason;
    `);
  }
}
