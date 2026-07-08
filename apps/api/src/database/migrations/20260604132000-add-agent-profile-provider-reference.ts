import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentProfileProviderReference20260604132000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS provider_id uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS provider_source character varying(32);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_provider_id
      ON agent_profiles(provider_id);
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'agent_profiles'::regclass
            AND conname = 'chk_agent_profiles_provider_source'
        ) THEN
          ALTER TABLE agent_profiles
            ADD CONSTRAINT chk_agent_profiles_provider_source
            CHECK (provider_source IS NULL OR provider_source IN ('global', 'user', 'scope'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      DROP CONSTRAINT IF EXISTS chk_agent_profiles_provider_source;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agent_profiles_provider_id;
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
      DROP COLUMN IF EXISTS provider_source;
    `);

    await queryRunner.query(`
      ALTER TABLE agent_profiles
      DROP COLUMN IF EXISTS provider_id;
    `);
  }
}
