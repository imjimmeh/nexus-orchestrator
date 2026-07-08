import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanSettings20260530120415 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_settings (
        key character varying(100) PRIMARY KEY,
        value jsonb NOT NULL,
        description text,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_settings");
  }
}
