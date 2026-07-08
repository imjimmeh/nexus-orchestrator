import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanEventDeliveryProjections20260518202800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS kanban_event_delivery_projections (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				event_id character varying(255) NOT NULL,
				event_name character varying(255) NOT NULL,
				project_id UUID,
				work_item_id UUID,
				workflow_run_id character varying(255),
				dedupe_key character varying(255),
				status character varying(32) NOT NULL,
				replay_count integer NOT NULL DEFAULT 0,
				last_attempted_at TIMESTAMP,
				accepted_at TIMESTAMP,
				last_error text,
				payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
				metadata jsonb,
				created_at TIMESTAMP NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);
    await queryRunner.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_event_delivery_event_id
			ON kanban_event_delivery_projections(event_id)
		`);
    await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS idx_kanban_event_delivery_project_status
			ON kanban_event_delivery_projections(project_id, status)
		`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_event_delivery_projections",
    );
  }
}
