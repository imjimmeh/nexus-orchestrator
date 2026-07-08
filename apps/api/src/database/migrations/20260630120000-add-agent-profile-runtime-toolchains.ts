import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentProfileRuntimeToolchains20260630120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS runtime_toolchains jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles DROP COLUMN IF EXISTS runtime_toolchains;
    `);
  }
}
