import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanOrchestrationLeases20260612190000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_leases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        conflict_key_kind character varying(32) NOT NULL,
        conflict_key_value character varying(512) NOT NULL,
        lane character varying(64) NOT NULL,
        owner_kind character varying(32) NOT NULL,
        owner_id character varying(255) NOT NULL,
        status character varying(16) NOT NULL,
        acquired_at TIMESTAMP NOT NULL,
        heartbeat_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        released_at TIMESTAMP NULL,
        metadata jsonb NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_orchestration_leases_active_key
      ON kanban_orchestration_leases (project_id, conflict_key_kind, conflict_key_value)
      WHERE status = 'active'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_leases_project_status
      ON kanban_orchestration_leases (project_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_leases_project_lane_status
      ON kanban_orchestration_leases (project_id, lane, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_orchestration_leases");
  }
}
