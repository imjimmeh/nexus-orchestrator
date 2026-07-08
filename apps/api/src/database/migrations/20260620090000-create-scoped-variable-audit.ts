import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScopedVariableAudit20260620090000 implements MigrationInterface {
  name = 'CreateScopedVariableAudit20260620090000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scoped_variable_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope_node_id" uuid,
        "key" varchar(128) NOT NULL,
        "action" varchar(16) NOT NULL,
        "previous_value" jsonb,
        "new_value" jsonb,
        "actor" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scoped_variable_audit" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_scoped_variable_audit_scope_key"
        ON "scoped_variable_audit" ("scope_node_id", "key")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_scoped_variable_audit_scope_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scoped_variable_audit"`);
  }
}
