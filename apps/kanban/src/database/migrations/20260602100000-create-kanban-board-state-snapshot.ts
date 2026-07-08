import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanBoardStateSnapshot20260602100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createTable(queryRunner);
    await this.createIndexes(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_board_state_snapshots",
    );
  }

  private async createTable(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_board_state_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        idempotency_key character varying(255) NOT NULL,
        snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        work_item_count integer NOT NULL DEFAULT 0,
        column_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_board_state_snapshots_project_id
      ON kanban_board_state_snapshots(project_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_board_state_snapshots_idempotency_key
      ON kanban_board_state_snapshots(project_id, idempotency_key)
    `);
  }
}
