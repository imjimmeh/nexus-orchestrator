import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentAwaitSessionRef20260618000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_await
        ADD COLUMN IF NOT EXISTS "parent_session_ref" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_await
        DROP COLUMN IF EXISTS "parent_session_ref";
    `);
  }
}
