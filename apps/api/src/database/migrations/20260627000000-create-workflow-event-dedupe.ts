import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflowEventDedupe20260627000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_event_dedupe (
        dedupe_key character varying(512) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_workflow_event_dedupe PRIMARY KEY (dedupe_key)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_event_dedupe_key
      ON workflow_event_dedupe (dedupe_key);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_event_dedupe_created_at
      ON workflow_event_dedupe (created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS workflow_event_dedupe');
  }
}
