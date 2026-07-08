import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentProfileFallbackChain20260629121000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS fallback_chain jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles DROP COLUMN IF EXISTS fallback_chain;
    `);
  }
}
