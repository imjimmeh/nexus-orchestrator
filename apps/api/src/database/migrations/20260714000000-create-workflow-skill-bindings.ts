import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create `workflow_skill_bindings` (self-improvement pipeline Epic B):
 * records runtime skill -> (workflow | workflow step) assignments
 * separately from `workflows.yaml_definition` so a workflow reseed never
 * clobbers assignments applied outside of source control.
 *
 * Postgres treats `NULL` values as distinct in a plain UNIQUE constraint,
 * so a whole-workflow binding (`step_id IS NULL`) would not be deduped
 * against a second whole-workflow binding for the same
 * `(workflow_name, skill_name)` pair by a plain unique index on
 * `(workflow_name, step_id, skill_name)`. The expression index below keys
 * on `COALESCE(step_id, '')` instead, so `NULL` collapses to `''` and
 * whole-workflow bindings dedupe correctly while still remaining distinct
 * from any step-scoped binding sharing the same workflow/skill.
 */
export class CreateWorkflowSkillBindings20260714000000 implements MigrationInterface {
  name = 'CreateWorkflowSkillBindings20260714000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_skill_bindings (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workflow_name" varchar(200) NOT NULL,
        "step_id" varchar(200),
        "skill_name" varchar(200) NOT NULL,
        "provenance" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workflow_skill_bindings_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_skill_bindings
        ON workflow_skill_bindings (workflow_name, COALESCE(step_id, ''), skill_name);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_skill_bindings_workflow_name
        ON workflow_skill_bindings (workflow_name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS workflow_skill_bindings;`);
  }
}
