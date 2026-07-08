import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentProfileHarnessContributions20260624000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN IF NOT EXISTS harness_contributions jsonb NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS harness_contributions;
    `);
  }
}
