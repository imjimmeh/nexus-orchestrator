import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropLegacyAgentProfileToolColumns20260608120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        DROP COLUMN IF EXISTS allowed_tools,
        DROP COLUMN IF EXISTS denied_tools,
        DROP COLUMN IF EXISTS approval_required_tools;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
        ADD COLUMN allowed_tools text,
        ADD COLUMN denied_tools text,
        ADD COLUMN approval_required_tools text;
    `);
  }
}
