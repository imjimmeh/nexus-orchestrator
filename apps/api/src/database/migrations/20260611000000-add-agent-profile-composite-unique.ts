import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentProfileCompositeUnique20260611000000 implements MigrationInterface {
  name = 'AddAgentProfileCompositeUnique20260611000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add base_profile_id column
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
      ADD COLUMN IF NOT EXISTS "base_profile_id" uuid NULL
    `);

    // Drop old single-column unique on name (if it exists as a constraint)
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
      DROP CONSTRAINT IF EXISTS "UQ_agent_profiles_name"
    `);
    // Also try the TypeORM-generated constraint name
    await queryRunner
      .query(
        `
      ALTER TABLE "agent_profiles"
      DROP CONSTRAINT IF EXISTS "UQ_b68b17a97e83bae0ceed3e09f26"
    `,
      )
      .catch(() => undefined);

    // Drop old unique index on name if it exists
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_agent_profiles_name"
    `);

    // Create composite unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_profile_name_scope"
      ON "agent_profiles" ("name", "scope_node_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_profile_name_scope"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_profiles_name"
      ON "agent_profiles" ("name")
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_profiles" DROP COLUMN IF EXISTS "base_profile_id"
    `);
  }
}
