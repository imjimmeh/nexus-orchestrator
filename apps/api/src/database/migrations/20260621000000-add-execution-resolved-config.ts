import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionResolvedConfig20260621000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS provider varchar(64),
        ADD COLUMN IF NOT EXISTS model varchar(128),
        ADD COLUMN IF NOT EXISTS agent_profile_id uuid,
        ADD COLUMN IF NOT EXISTS agent_profile_name varchar(128),
        ADD COLUMN IF NOT EXISTS harness_id varchar(64),
        ADD COLUMN IF NOT EXISTS provider_source varchar(32),
        ADD COLUMN IF NOT EXISTS input_tokens bigint,
        ADD COLUMN IF NOT EXISTS output_tokens bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS provider,
        DROP COLUMN IF EXISTS model,
        DROP COLUMN IF EXISTS agent_profile_id,
        DROP COLUMN IF EXISTS agent_profile_name,
        DROP COLUMN IF EXISTS harness_id,
        DROP COLUMN IF EXISTS provider_source,
        DROP COLUMN IF EXISTS input_tokens,
        DROP COLUMN IF EXISTS output_tokens;
    `);
  }
}
