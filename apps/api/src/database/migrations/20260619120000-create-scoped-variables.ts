import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScopedVariables20260619120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scoped_variables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_node_id UUID,
        key character varying(128) NOT NULL,
        value jsonb NOT NULL,
        value_type character varying(16) NOT NULL,
        source character varying(16) NOT NULL DEFAULT 'admin',
        description text,
        created_by character varying,
        updated_by character varying,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS UQ_scoped_variable_key_scope
        ON scoped_variables(key, scope_node_id);
    `);

    // Enforce a single global row per key (scope_node_id IS NULL is not
    // deduplicated by the composite unique index above on most engines).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS UQ_scoped_variable_key_global
        ON scoped_variables(key) WHERE scope_node_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS scoped_variables;');
  }
}
