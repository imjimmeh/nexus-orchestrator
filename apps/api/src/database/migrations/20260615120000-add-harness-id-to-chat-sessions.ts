import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHarnessIdToChatSessions20260615120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_sessions
        ADD COLUMN IF NOT EXISTS harness_id character varying(64);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_sessions
        DROP COLUMN IF EXISTS harness_id;
    `);
  }
}
