import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelCostRateColumns20260604120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        ADD COLUMN IF NOT EXISTS input_token_cents_per_million integer,
        ADD COLUMN IF NOT EXISTS output_token_cents_per_million integer;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        DROP COLUMN IF EXISTS input_token_cents_per_million,
        DROP COLUMN IF EXISTS output_token_cents_per_million;
    `);
  }
}
