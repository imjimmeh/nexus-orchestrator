import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the legacy `subagent_executions` table. Subagent lifecycle is now the
 * sole responsibility of the consolidated `executions` table (state via domain
 * events) plus the `subagent_details` satellite; nothing writes or reads
 * `subagent_executions` anymore.
 *
 * `down()` recreates the table with its full original schema (faithful to the
 * `20260517000000-api-post-cutover-baseline` definition) so the migration is
 * reversible, but it does not backfill rows.
 */
export class DropSubagentExecutions20260614210000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS subagent_executions');
    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."subagent_executions_status_enum"',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."subagent_executions_status_enum" AS ENUM('Spawning', 'Running', 'Completed', 'Failed');`,
    );
    await queryRunner.query(
      `CREATE TABLE "subagent_executions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "parent_container_id" character varying NOT NULL, "child_container_id" character varying, "delegation_contract_id" uuid, "lineage_trace_id" character varying(255), "lineage_parent_trace_id" character varying(255), "parent_session_tree_id" character varying, "depth" integer NOT NULL DEFAULT '0', "status" "public"."subagent_executions_status_enum" NOT NULL DEFAULT 'Spawning', "result" jsonb, "assigned_files" jsonb, "subagent_chat_session_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, CONSTRAINT "PK_1587a2a2f158573c9c8d0e9451c" PRIMARY KEY ("id"));`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24f4b060f71ce1142e97533f43" ON "subagent_executions" ("parent_container_id") ;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f67904fdbca660994dba59f62" ON "subagent_executions" ("child_container_id") ;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe6798fbf0da0bd1b9001c0bc2" ON "subagent_executions" ("delegation_contract_id") ;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62f3a0e57c253f0e8a980a46c7" ON "subagent_executions" ("lineage_trace_id") ;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2172a63ab317de7f1dafc88df0" ON "subagent_executions" ("subagent_chat_session_id") ;`,
    );
  }
}
