import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLlmProviderId20260607113000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add the column with default 'custom'
    await queryRunner.query(`
      ALTER TABLE llm_providers
      ADD COLUMN IF NOT EXISTS provider_id character varying(255) DEFAULT 'custom';
    `);

    // 2. Backfill provider_id from runtime_env if pi_provider is defined
    await queryRunner.query(`
      UPDATE llm_providers
      SET provider_id = (runtime_env->>'pi_provider')
      WHERE runtime_env ? 'pi_provider'
        AND runtime_env->>'pi_provider' IS NOT NULL
        AND runtime_env->>'pi_provider' != '';
    `);

    // 3. Backfill common provider_ids if still 'custom'
    await queryRunner.query(`
      UPDATE llm_providers
      SET provider_id = 'openai'
      WHERE provider_id = 'custom'
        AND (LOWER(name) = 'openai' OR LOWER(name) = 'openai-codex');

      UPDATE llm_providers
      SET provider_id = 'anthropic'
      WHERE provider_id = 'custom'
        AND LOWER(name) = 'anthropic';

      UPDATE llm_providers
      SET provider_id = 'google'
      WHERE provider_id = 'custom'
        AND (LOWER(name) = 'google' OR LOWER(name) = 'gemini' OR LOWER(name) = 'google gemini');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_providers
      DROP COLUMN IF EXISTS provider_id;
    `);
  }
}
