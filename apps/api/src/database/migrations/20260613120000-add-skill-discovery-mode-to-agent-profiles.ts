import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkillDiscoveryModeToAgentProfiles20260613120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS skill_discovery_mode character varying(32) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS skill_discovery_mode;
    `);
  }
}
