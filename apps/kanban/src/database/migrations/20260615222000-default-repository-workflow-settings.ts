import { MigrationInterface, QueryRunner } from "typeorm";

const DEFAULT_SETTINGS = '{"enabled": true, "overrides": {}}';

/**
 * Repository lifecycle gates default to ON. The original column was nullable
 * with no default, so projects that never toggled the setting kept a NULL value
 * that the transition gate read as "disabled" — meaning gates never fired.
 * Backfill existing NULLs, set a column default, and forbid NULL going forward
 * so an absent value can no longer mean two different things.
 */
export class DefaultRepositoryWorkflowSettings20260615222000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE kanban_projects SET repository_workflow_settings = '${DEFAULT_SETTINGS}'::jsonb WHERE repository_workflow_settings IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE kanban_projects ALTER COLUMN repository_workflow_settings SET DEFAULT '${DEFAULT_SETTINGS}'::jsonb`,
    );
    await queryRunner.query(
      "ALTER TABLE kanban_projects ALTER COLUMN repository_workflow_settings SET NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_projects ALTER COLUMN repository_workflow_settings DROP NOT NULL",
    );
    await queryRunner.query(
      "ALTER TABLE kanban_projects ALTER COLUMN repository_workflow_settings DROP DEFAULT",
    );
  }
}
