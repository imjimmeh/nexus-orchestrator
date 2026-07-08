import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddToolRegistrySource20260714030000 implements MigrationInterface {
  name = 'AddToolRegistrySource20260714030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'manual';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      DROP COLUMN IF EXISTS source;
    `);
  }
}
