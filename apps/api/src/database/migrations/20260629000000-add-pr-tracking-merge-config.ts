import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add auto_merge + merge_method to pull_request_tracking (EPIC-209 Phase 5).
 * Lets the poll reconciler decide whether to API-merge and with which method
 * without a downstream round-trip. Additive, default-backfilled, neutral.
 */
export class AddPrTrackingMergeConfig20260629000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pull_request_tracking
        ADD COLUMN IF NOT EXISTS "auto_merge" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "merge_method" varchar(16) NOT NULL DEFAULT 'merge';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pull_request_tracking
        DROP COLUMN IF EXISTS "merge_method",
        DROP COLUMN IF EXISTS "auto_merge";
    `);
  }
}
