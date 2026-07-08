import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScopedAiDefault20260612020000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE scoped_ai_default (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_node_id UUID NULL,
        harness_id TEXT NULL,
        model_name TEXT NULL,
        provider_name TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // NOTE: Postgres treats NULL as distinct in a UNIQUE index, so this index
    // enforces a single row per non-null scope only. The single platform (NULL-scope)
    // row is enforced at the repository layer (find-then-save in upsertForScope).
    await queryRunner.query(
      `CREATE UNIQUE INDEX scoped_ai_default_scope_node_id_idx ON scoped_ai_default (scope_node_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS scoped_ai_default`);
  }
}
