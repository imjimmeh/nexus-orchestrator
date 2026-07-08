import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopedConfigurableResourceOwnership20260604130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_providers
        ADD COLUMN IF NOT EXISTS owner_type character varying NOT NULL DEFAULT 'global',
        ADD COLUMN IF NOT EXISTS owner_id character varying,
        ADD COLUMN IF NOT EXISTS oauth_authorization_url character varying,
        ADD COLUMN IF NOT EXISTS oauth_token_url character varying,
        ADD COLUMN IF NOT EXISTS oauth_client_id character varying,
        ADD COLUMN IF NOT EXISTS oauth_client_secret_id uuid,
        ADD COLUMN IF NOT EXISTS oauth_scopes jsonb,
        ADD COLUMN IF NOT EXISTS oauth_redirect_uri character varying;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'llm_providers'::regclass
            AND conname = 'chk_llm_providers_oauth_scopes_array'
        ) THEN
          ALTER TABLE llm_providers
            ADD CONSTRAINT chk_llm_providers_oauth_scopes_array
            CHECK (oauth_scopes IS NULL OR jsonb_typeof(oauth_scopes) = 'array');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE secret_store
        ADD COLUMN IF NOT EXISTS owner_type character varying NOT NULL DEFAULT 'global',
        ADD COLUMN IF NOT EXISTS owner_id character varying;
    `);

    await queryRunner.query(
      `ALTER TABLE llm_providers DROP CONSTRAINT IF EXISTS "UQ_ffeba8a7b7ae85e8c1a76f7440a"`,
    );

    await queryRunner.query(
      `ALTER TABLE secret_store DROP CONSTRAINT IF EXISTS "UQ_80a592ee31e500c5ba305a82584"`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_llm_providers_owner_name" ON llm_providers (owner_type, COALESCE(owner_id, ''), name)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_secret_store_owner_name" ON secret_store (owner_type, COALESCE(owner_id, ''), name)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_llm_providers_owner" ON llm_providers (owner_type, owner_id)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_secret_store_owner" ON secret_store (owner_type, owner_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.guardNoScopedRows(queryRunner);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_secret_store_owner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_llm_providers_owner"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_secret_store_owner_name"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_llm_providers_owner_name"`,
    );

    await queryRunner.query(
      `ALTER TABLE llm_providers DROP CONSTRAINT IF EXISTS chk_llm_providers_oauth_scopes_array`,
    );

    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_redirect_uri`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_scopes`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_client_secret_id`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_client_id`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_token_url`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS oauth_authorization_url`,
    );

    await queryRunner.query(
      `ALTER TABLE secret_store DROP COLUMN IF EXISTS owner_id`,
    );
    await queryRunner.query(
      `ALTER TABLE secret_store DROP COLUMN IF EXISTS owner_type`,
    );

    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS owner_id`,
    );
    await queryRunner.query(
      `ALTER TABLE llm_providers DROP COLUMN IF EXISTS owner_type`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'llm_providers'::regclass
            AND conname = 'UQ_ffeba8a7b7ae85e8c1a76f7440a'
        ) THEN
          ALTER TABLE llm_providers ADD CONSTRAINT "UQ_ffeba8a7b7ae85e8c1a76f7440a" UNIQUE (name);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'secret_store'::regclass
            AND conname = 'UQ_80a592ee31e500c5ba305a82584'
        ) THEN
          ALTER TABLE secret_store ADD CONSTRAINT "UQ_80a592ee31e500c5ba305a82584" UNIQUE (name);
        END IF;
      END $$;
    `);
  }

  private async guardNoScopedRows(queryRunner: QueryRunner): Promise<void> {
    const llmCheck = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM llm_providers WHERE owner_type != 'global' OR owner_id IS NOT NULL`,
    )) as Array<{ count: string | number }> | { count: string | number };
    const secretCheck = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM secret_store WHERE owner_type != 'global' OR owner_id IS NOT NULL`,
    )) as Array<{ count: string | number }> | { count: string | number };

    const llmCount = Array.isArray(llmCheck)
      ? Number(llmCheck[0]?.count ?? 0)
      : Number(llmCheck.count ?? 0);
    const secretCount = Array.isArray(secretCheck)
      ? Number(secretCheck[0]?.count ?? 0)
      : Number(secretCheck.count ?? 0);

    if (llmCount > 0 || secretCount > 0) {
      throw new Error(
        `Rollback is unsafe: ${llmCount} scoped llm_providers row(s) and ${secretCount} scoped secret_store row(s) exist. Remove scoped configurable resources before rolling back this migration.`,
      );
    }
  }
}
