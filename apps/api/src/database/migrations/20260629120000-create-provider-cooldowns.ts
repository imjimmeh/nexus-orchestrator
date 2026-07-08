import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProviderCooldowns20260629120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_cooldowns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_name character varying(255) NOT NULL,
        reason character varying(32) NOT NULL,
        cooled_until TIMESTAMP NOT NULL,
        last_failure_at TIMESTAMP NOT NULL,
        source_run_id character varying(64),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_cooldowns_provider_name
      ON provider_cooldowns(provider_name);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_cooldowns_cooled_until
      ON provider_cooldowns(cooled_until);
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'provider_cooldowns'::regclass
            AND conname = 'chk_provider_cooldowns_reason'
        ) THEN
          ALTER TABLE provider_cooldowns
            ADD CONSTRAINT chk_provider_cooldowns_reason
            CHECK (reason IN ('usage_exhausted','billing_exhausted','auth_failed','provider_outage'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS provider_cooldowns');
  }
}
