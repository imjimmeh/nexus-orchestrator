import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameWorkflowRunTodoSourceContextItem20260613010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_subtask_id'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_context_item_id'
        )
        THEN
          ALTER TABLE workflow_run_todos
            RENAME COLUMN source_subtask_id TO source_context_item_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_run_todos
        ADD COLUMN IF NOT EXISTS source_context_item_id varchar(255);
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_workflow_run_todos_run_subtask;`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_run_todos_run_context_item
        ON workflow_run_todos (workflow_run_id, source_context_item_id)
        WHERE source_context_item_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_workflow_run_todos_run_context_item;`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_context_item_id'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'workflow_run_todos' AND column_name = 'source_subtask_id'
        )
        THEN
          ALTER TABLE workflow_run_todos
            RENAME COLUMN source_context_item_id TO source_subtask_id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_run_todos_run_subtask
        ON workflow_run_todos (workflow_run_id, source_subtask_id)
        WHERE source_subtask_id IS NOT NULL;
    `);
  }
}
