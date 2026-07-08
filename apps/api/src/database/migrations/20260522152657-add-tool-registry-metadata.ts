import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddToolRegistryMetadata20260522152657 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      ADD COLUMN IF NOT EXISTS description text;
    `);

    await queryRunner.query(`
      ALTER TABLE tool_registry
      ADD COLUMN IF NOT EXISTS metadata jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      DROP COLUMN IF EXISTS metadata;
    `);

    await queryRunner.query(`
      ALTER TABLE tool_registry
      DROP COLUMN IF EXISTS description;
    `);
  }
}
