import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time reset: wipe every existing skill assignment and skill definition
 * now that project/project+agent scoping (this feature) is built and tested.
 * Per explicit product decision, this clears ALL assignments, including ones
 * an operator configured by hand — not just pipeline-created ones — since
 * none of the pre-existing data carries scope information the new system
 * can make sense of. `agent_profile_skill_bindings` (this feature's own new
 * table) is not touched — it starts empty regardless.
 */
export class ResetSkillScopeData20260714050000 implements MigrationInterface {
  name = 'ResetSkillScopeData20260714050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE agent_profiles SET assigned_skills = NULL;`,
    );
    await queryRunner.query(`DELETE FROM agent_profile_skills;`);
    await queryRunner.query(`DELETE FROM agent_skills;`);
    await queryRunner.query(`DELETE FROM skills;`);
    await queryRunner.query(
      `DELETE FROM improvement_proposals WHERE kind IN ('skill_create', 'skill_assignment');`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally irreversible: the deleted rows and cleared column values
    // cannot be reconstructed. A rollback of this migration is a no-op.
  }
}
