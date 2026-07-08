import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExecutions20260615000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS executions (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(32) NOT NULL,
        "parent_execution_id" uuid,
        "workflow_run_id" uuid,
        "chat_session_id" uuid,
        "scope_id" uuid,
        "context_id" varchar(255),
        "container_id" varchar(128),
        "container_tier" smallint NOT NULL DEFAULT 2,
        "state" varchar(32) NOT NULL DEFAULT 'pending',
        "failure_reason" varchar(48),
        "error_message" text,
        "last_heartbeat_at" timestamp,
        "attempt" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "terminal_at" timestamp,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_executions_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_state" ON executions ("state");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_kind_state" ON executions ("kind","state");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_state_heartbeat" ON executions ("state","last_heartbeat_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_workflow_run_id" ON executions ("workflow_run_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_chat_session_id" ON executions ("chat_session_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS executions;`);
  }
}
