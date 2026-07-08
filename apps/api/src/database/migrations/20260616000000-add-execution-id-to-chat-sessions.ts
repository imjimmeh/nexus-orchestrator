import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionIdToChatSessions20260616000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_sessions
      ADD COLUMN IF NOT EXISTS execution_id uuid;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_sessions_execution_id" ON chat_sessions (execution_id) WHERE execution_id IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chat_sessions_execution_id";`,
    );
    await queryRunner.query(`
      ALTER TABLE chat_sessions
      DROP COLUMN IF EXISTS execution_id;
    `);
  }
}
