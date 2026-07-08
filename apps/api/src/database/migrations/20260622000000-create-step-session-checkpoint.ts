import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStepSessionCheckpoint20260622000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS step_session_checkpoint (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "execution_id" uuid NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "step_id" text NOT NULL,
        "engine" varchar(64) NOT NULL,
        "session_ref" jsonb,
        "resume_node_id" text,
        "transcript_locator" text,
        "phase" varchar(8) NOT NULL,
        "call_seq" int NOT NULL,
        "tool_name" text,
        "idempotency_key" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_step_session_checkpoint_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_step_session_checkpoint_run_step_seq" ON step_session_checkpoint ("workflow_run_id", "step_id", "call_seq");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_step_session_checkpoint_execution_id" ON step_session_checkpoint ("execution_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_step_session_checkpoint_workflow_run_id" ON step_session_checkpoint ("workflow_run_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS step_session_checkpoint;`);
  }
}
