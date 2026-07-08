import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecretReferencesToMcpAcpServers20260604010718 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mcp_servers
        ADD COLUMN IF NOT EXISTS headers_secret_id uuid,
        ADD COLUMN IF NOT EXISTS env jsonb,
        ADD COLUMN IF NOT EXISTS env_secret_id uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE acp_servers
        ADD COLUMN IF NOT EXISTS auth_secret_id uuid,
        ADD COLUMN IF NOT EXISTS headers_secret_id uuid;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_headers_secret_id
      ON mcp_servers(headers_secret_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_servers_env_secret_id
      ON mcp_servers(env_secret_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_acp_servers_auth_secret_id
      ON acp_servers(auth_secret_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_acp_servers_headers_secret_id
      ON acp_servers(headers_secret_id);
    `);

    await this.addForeignKeyIfMissing(
      queryRunner,
      'mcp_servers',
      'fk_mcp_servers_headers_secret_id',
      'headers_secret_id',
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'mcp_servers',
      'fk_mcp_servers_env_secret_id',
      'env_secret_id',
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'acp_servers',
      'fk_acp_servers_auth_secret_id',
      'auth_secret_id',
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'acp_servers',
      'fk_acp_servers_headers_secret_id',
      'headers_secret_id',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mcp_servers
        DROP CONSTRAINT IF EXISTS fk_mcp_servers_headers_secret_id,
        DROP CONSTRAINT IF EXISTS fk_mcp_servers_env_secret_id;
    `);
    await queryRunner.query(`
      ALTER TABLE acp_servers
        DROP CONSTRAINT IF EXISTS fk_acp_servers_auth_secret_id,
        DROP CONSTRAINT IF EXISTS fk_acp_servers_headers_secret_id;
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_mcp_servers_headers_secret_id;',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_mcp_servers_env_secret_id;',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_acp_servers_auth_secret_id;',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_acp_servers_headers_secret_id;',
    );

    await queryRunner.query(`
      ALTER TABLE mcp_servers
        DROP COLUMN IF EXISTS headers_secret_id,
        DROP COLUMN IF EXISTS env,
        DROP COLUMN IF EXISTS env_secret_id;
    `);
    await queryRunner.query(`
      ALTER TABLE acp_servers
        DROP COLUMN IF EXISTS auth_secret_id,
        DROP COLUMN IF EXISTS headers_secret_id;
    `);
  }

  private async addForeignKeyIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    constraintName: string,
    columnName: string,
  ): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = '${constraintName}'
        ) THEN
          ALTER TABLE ${tableName}
          ADD CONSTRAINT ${constraintName}
          FOREIGN KEY (${columnName}) REFERENCES secret_store(id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }
}
