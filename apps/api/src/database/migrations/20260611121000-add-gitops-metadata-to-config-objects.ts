import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGitopsMetadataToConfigObjects20260611121000 implements MigrationInterface {
  name = 'AddGitopsMetadataToConfigObjects20260611121000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflows"
        ADD COLUMN IF NOT EXISTS "managed_by" text NULL,
        ADD COLUMN IF NOT EXISTS "managed_binding_id" uuid NULL REFERENCES "gitops_repository_bindings"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "managed_revision" text NULL,
        ADD COLUMN IF NOT EXISTS "last_git_hash" text NULL,
        ADD COLUMN IF NOT EXISTS "sync_state" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        ADD COLUMN IF NOT EXISTS "managed_by" text NULL,
        ADD COLUMN IF NOT EXISTS "managed_binding_id" uuid NULL REFERENCES "gitops_repository_bindings"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "managed_revision" text NULL,
        ADD COLUMN IF NOT EXISTS "last_git_hash" text NULL,
        ADD COLUMN IF NOT EXISTS "sync_state" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "skills"
        ADD COLUMN IF NOT EXISTS "managed_by" text NULL,
        ADD COLUMN IF NOT EXISTS "managed_binding_id" uuid NULL REFERENCES "gitops_repository_bindings"("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "managed_revision" text NULL,
        ADD COLUMN IF NOT EXISTS "last_git_hash" text NULL,
        ADD COLUMN IF NOT EXISTS "sync_state" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "workflows"
      DROP CONSTRAINT IF EXISTS "chk_workflows_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflows"
      ADD CONSTRAINT "chk_workflows_source"
      CHECK ("source" IN ('seeded', 'admin', 'repository'))
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
      DROP CONSTRAINT IF EXISTS "chk_agent_profiles_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
      ADD CONSTRAINT "chk_agent_profiles_source"
      CHECK ("source" IN ('seeded', 'admin', 'agent_factory', 'repository'))
    `);

    await queryRunner.query(`
      ALTER TABLE "skills"
      DROP CONSTRAINT IF EXISTS "chk_skills_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "skills"
      ADD CONSTRAINT "chk_skills_source"
      CHECK ("source" IN ('imported', 'admin', 'agent_factory', 'repository'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skills"
      DROP CONSTRAINT IF EXISTS "chk_skills_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
      DROP CONSTRAINT IF EXISTS "chk_agent_profiles_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "workflows"
      DROP CONSTRAINT IF EXISTS "chk_workflows_source"
    `);

    await queryRunner.query(`
      ALTER TABLE "skills"
        DROP COLUMN IF EXISTS "sync_state",
        DROP COLUMN IF EXISTS "last_git_hash",
        DROP COLUMN IF EXISTS "managed_revision",
        DROP COLUMN IF EXISTS "managed_binding_id",
        DROP COLUMN IF EXISTS "managed_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        DROP COLUMN IF EXISTS "sync_state",
        DROP COLUMN IF EXISTS "last_git_hash",
        DROP COLUMN IF EXISTS "managed_revision",
        DROP COLUMN IF EXISTS "managed_binding_id",
        DROP COLUMN IF EXISTS "managed_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "workflows"
        DROP COLUMN IF EXISTS "sync_state",
        DROP COLUMN IF EXISTS "last_git_hash",
        DROP COLUMN IF EXISTS "managed_revision",
        DROP COLUMN IF EXISTS "managed_binding_id",
        DROP COLUMN IF EXISTS "managed_by"
    `);
  }
}
