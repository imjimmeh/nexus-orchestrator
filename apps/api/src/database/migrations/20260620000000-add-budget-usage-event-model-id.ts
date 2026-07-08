import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBudgetUsageEventModelId20260620000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE budget_usage_events
        ADD COLUMN IF NOT EXISTS model_id uuid;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_usage_events_model_id
        ON budget_usage_events (model_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_budget_usage_events_model_id;
    `);
    await queryRunner.query(`
      ALTER TABLE budget_usage_events
        DROP COLUMN IF EXISTS model_id;
    `);
  }
}
