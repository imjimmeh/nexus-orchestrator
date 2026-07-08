import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRepairSession20260613020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS repair_session (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "errorEventId" varchar,
        "errorCode" varchar,
        "errorMessage" text,
        "status" varchar NOT NULL,
        "dedupKey" varchar,
        "opencodeOutput" text,
        "fixDescription" text,
        "commitHash" varchar,
        "commitMessage" varchar,
        "commitPushed" boolean NOT NULL DEFAULT false,
        "dockerRebuildResult" jsonb,
        "errorLog" text,
        "startedAt" timestamp,
        "completedAt" timestamp,
        "workflowId" varchar,
        "workflowRunId" varchar,
        "correlationId" varchar,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_repair_session_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_status" ON repair_session ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_dedupKey" ON repair_session ("dedupKey");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repair_session_createdAt" ON repair_session ("createdAt");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS repair_session;`);
  }
}
