import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkillsTable20260611020000 implements MigrationInterface {
  name = 'CreateSkillsTable20260611020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skills" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "skill_markdown" text NOT NULL DEFAULT '',
        "category" varchar(64),
        "tags" text,
        "metadata" jsonb,
        "scope_node_id" uuid,
        "source" varchar(32) NOT NULL DEFAULT 'admin',
        "locked" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "is_active" boolean NOT NULL DEFAULT true,
        "overrides" jsonb,
        "base_ref" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skills" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_skill_name_scope"
      ON "skills" ("name", "scope_node_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "skills"`);
  }
}
