import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterRetrospectiveQueueAddChatSession20260711000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE retrospective_queue ALTER COLUMN workflow_run_id DROP NOT NULL;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_retrospective_queue_workflow_run_id;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_retrospective_queue_workflow_run_id
      ON retrospective_queue(workflow_run_id)
      WHERE workflow_run_id IS NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE retrospective_queue
      ADD COLUMN chat_session_id UUID NULL,
      ADD COLUMN source_type character varying(32) NOT NULL DEFAULT 'workflow_run';
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_retrospective_queue_chat_session_id
      ON retrospective_queue(chat_session_id)
      WHERE chat_session_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_retrospective_queue_chat_session_id;
    `);

    await queryRunner.query(`
      ALTER TABLE retrospective_queue
      DROP COLUMN IF EXISTS chat_session_id,
      DROP COLUMN IF EXISTS source_type;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_retrospective_queue_workflow_run_id;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_retrospective_queue_workflow_run_id
      ON retrospective_queue(workflow_run_id);
    `);

    await queryRunner.query(`
      ALTER TABLE retrospective_queue ALTER COLUMN workflow_run_id SET NOT NULL;
    `);
  }
}
