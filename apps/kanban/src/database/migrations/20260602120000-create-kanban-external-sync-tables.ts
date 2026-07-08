import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanExternalSyncTables20260602120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_external_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES kanban_projects(id) ON DELETE CASCADE,
        provider_type character varying(64) NOT NULL,
        name character varying(255) NOT NULL,
        status character varying(32) NOT NULL DEFAULT 'active',
        sync_mode character varying(32) NOT NULL DEFAULT 'bidirectional',
        sync_transport character varying(32) NOT NULL DEFAULT 'manual',
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        webhook_secret_ref character varying(255),
        poll_interval_seconds integer,
        last_sync_at TIMESTAMP,
        last_sync_error text,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_external_connections_project_id
      ON kanban_external_connections(project_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_external_connections_project_provider_name
      ON kanban_external_connections(project_id, provider_type, name)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_external_connections_active_polling
      ON kanban_external_connections(status, sync_transport, sync_mode)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_sync_operation_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id UUID NOT NULL REFERENCES kanban_external_connections(id) ON DELETE CASCADE,
        project_id UUID NOT NULL REFERENCES kanban_projects(id) ON DELETE CASCADE,
        work_item_id UUID REFERENCES kanban_work_items(id) ON DELETE SET NULL,
        external_id character varying(255),
        direction character varying(32) NOT NULL,
        operation character varying(32) NOT NULL,
        status character varying(32) NOT NULL,
        message text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_sync_operation_log_connection_created
      ON kanban_sync_operation_log(connection_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_sync_operation_log_project_created
      ON kanban_sync_operation_log(project_id, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_sync_operation_log_work_item
      ON kanban_sync_operation_log(work_item_id) WHERE work_item_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_sync_operation_log_external_ref
      ON kanban_sync_operation_log(connection_id, external_id) WHERE external_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_sync_operation_log");
    await queryRunner.query("DROP TABLE IF EXISTS kanban_external_connections");
  }
}
