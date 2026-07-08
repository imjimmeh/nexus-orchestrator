import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProviderOAuthSessions20260604131000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_oauth_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
        state_hash character varying(128) NOT NULL,
        code_verifier text NOT NULL,
        redirect_uri character varying(2048) NOT NULL,
        owner_type character varying(32) NOT NULL DEFAULT 'global',
        owner_id character varying(255),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_oauth_sessions_state_hash
      ON provider_oauth_sessions(state_hash);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_oauth_sessions_provider_id
      ON provider_oauth_sessions(provider_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_oauth_sessions_expires_at
      ON provider_oauth_sessions(expires_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_oauth_sessions_owner
      ON provider_oauth_sessions(owner_type, owner_id);
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'provider_oauth_sessions'::regclass
            AND conname = 'chk_provider_oauth_sessions_owner_type'
        ) THEN
          ALTER TABLE provider_oauth_sessions
            ADD CONSTRAINT chk_provider_oauth_sessions_owner_type
            CHECK (owner_type IN ('global', 'user', 'scope'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS provider_oauth_sessions');
  }
}
