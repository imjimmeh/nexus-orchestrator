import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentAwait20260617000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agent_await (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "parent_run_id" uuid NOT NULL,
        "parent_step_id" text NOT NULL,
        "parent_session_tree_id" uuid,
        "awaited_run_ids" jsonb NOT NULL,
        "satisfied_run_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'WAITING',
        "resume_node_id" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_await_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_await_parent_run_id" ON agent_await ("parent_run_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agent_await;`);
  }
}
