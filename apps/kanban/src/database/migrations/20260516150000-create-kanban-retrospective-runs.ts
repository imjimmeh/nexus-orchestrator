import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanRetrospectiveRuns20260516150000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_retrospective_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key character varying(255) NOT NULL,
        project_id UUID NOT NULL,
        orchestration_id UUID,
        trigger_type character varying(64) NOT NULL,
        trigger_revision_marker character varying(255),
        replay_of_run_id UUID,
        status character varying(32) NOT NULL,
        skip_reason character varying(64),
        failure_reason text,
        candidate_count integer NOT NULL DEFAULT 0,
        learning_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        delta_snapshot_json jsonb,
        diagnostics_json jsonb,
        started_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_idempotency_key
      ON kanban_retrospective_runs(idempotency_key)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_project_created
      ON kanban_retrospective_runs(project_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_retrospective_runs_status_created
      ON kanban_retrospective_runs(status, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_retrospective_runs");
  }
}
