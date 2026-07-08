import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowRunStartCompleteTimestamps20260624000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP NULL;
    `);

    // Backfill: existing runs that ever left PENDING have effectively started.
    await queryRunner.query(`
      UPDATE "workflow_runs"
        SET "started_at" = "created_at"
        WHERE "started_at" IS NULL
          AND "status" <> 'PENDING';
    `);

    // Backfill: terminal runs completed at their last update.
    await queryRunner.query(`
      UPDATE "workflow_runs"
        SET "completed_at" = "updated_at"
        WHERE "completed_at" IS NULL
          AND "status" IN ('COMPLETED', 'FAILED', 'CANCELLED');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        DROP COLUMN IF EXISTS "completed_at",
        DROP COLUMN IF EXISTS "started_at";
    `);
  }
}
