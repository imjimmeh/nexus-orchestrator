import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create `agent_profile_skill_bindings`: runtime skill -> (scope_node |
 * scope_node + agent_profile) assignment, recorded separately from
 * `agent_profiles.assigned_skills` so it can never be clobbered by a profile
 * reseed. Mirrors `workflow_skill_bindings`'s COALESCE-expression-index
 * technique: `agent_profile_id IS NULL` means "any profile within this scope
 * node", and a plain UNIQUE constraint would fail to dedupe two such rows for
 * the same `(scope_node_id, skill_name)` pair because Postgres treats NULLs
 * as distinct. `COALESCE(agent_profile_id, '00000000-0000-0000-0000-000000000000')`
 * collapses NULL to a fixed sentinel so whole-scope bindings dedupe correctly
 * while remaining distinct from any profile-scoped binding sharing the same
 * scope/skill.
 */
export class CreateAgentProfileSkillBindings20260714040000 implements MigrationInterface {
  name = 'CreateAgentProfileSkillBindings20260714040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agent_profile_skill_bindings (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agent_profile_id" uuid,
        "scope_node_id" uuid NOT NULL,
        "skill_name" varchar(64) NOT NULL,
        "provenance" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_profile_skill_bindings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_profile_skill_bindings_scope_node"
          FOREIGN KEY ("scope_node_id") REFERENCES scope_nodes(id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profile_skill_bindings
        ON agent_profile_skill_bindings (
          COALESCE(agent_profile_id, '00000000-0000-0000-0000-000000000000'),
          scope_node_id,
          skill_name
        );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_profile_skill_bindings_scope_node
        ON agent_profile_skill_bindings (scope_node_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS agent_profile_skill_bindings;`,
    );
  }
}
