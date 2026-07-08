import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupportsVisionColumns20260608150000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        ADD COLUMN IF NOT EXISTS supports_vision boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS supports_vision boolean DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        DROP COLUMN IF EXISTS supports_vision;
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS supports_vision;
    `);
  }
}
