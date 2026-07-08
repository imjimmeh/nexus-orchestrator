import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuntimeFeedbackWindowState20260517110000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE runtime_feedback_signal_groups
      ADD COLUMN IF NOT EXISTS window_occurrence_count integer NOT NULL DEFAULT 0;
    `);

    await queryRunner.query(`
      ALTER TABLE runtime_feedback_signal_groups
      ADD COLUMN IF NOT EXISTS window_started_at timestamptz;
    `);

    await queryRunner.query(`
      UPDATE runtime_feedback_signal_groups
      SET
        window_occurrence_count = occurrence_count,
        window_started_at = COALESCE(first_seen_at, last_seen_at, NOW())
      WHERE window_started_at IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE runtime_feedback_signal_groups
      ALTER COLUMN window_started_at SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE runtime_feedback_signal_groups
      DROP COLUMN IF EXISTS window_started_at;
    `);

    await queryRunner.query(`
      ALTER TABLE runtime_feedback_signal_groups
      DROP COLUMN IF EXISTS window_occurrence_count;
    `);
  }
}
