import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanImportedRepositoryFindings20260519120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_imported_repository_findings (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id          UUID            NOT NULL,
        source_id           VARCHAR(255)    NOT NULL,
        source_hash         VARCHAR(64)     NOT NULL,
        probe_artifact_path VARCHAR(512)    NOT NULL,
        probe_scope_id      VARCHAR(255),
        project_scope_id    VARCHAR(255),
        title               VARCHAR(255)    NOT NULL,
        reason              TEXT            NOT NULL,
        finding_kind        VARCHAR(64)     NOT NULL,
        recommended_work_type VARCHAR(64)   NOT NULL,
        recommended_status  VARCHAR(32)     NOT NULL,
        status              VARCHAR(64)     NOT NULL DEFAULT 'pending_investigation',
        confidence_score    DOUBLE PRECISION,
        evidence            JSONB           NOT NULL DEFAULT '{}'::jsonb,
        decision            JSONB,
        work_item_id        UUID,
        metadata            JSONB,
        observed_at         TIMESTAMP       NOT NULL,
        resolved_at         TIMESTAMP,
        created_at          TIMESTAMP       NOT NULL DEFAULT now(),
        updated_at          TIMESTAMP       NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_imported_repository_findings_project_source
        ON kanban_imported_repository_findings (project_id, source_id);

      CREATE INDEX IF NOT EXISTS idx_kanban_imported_repository_findings_project_status
        ON kanban_imported_repository_findings (project_id, status, updated_at);

      CREATE INDEX IF NOT EXISTS idx_kanban_imported_repository_findings_project_work_item
        ON kanban_imported_repository_findings (project_id, work_item_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS kanban_imported_repository_findings;
    `);
  }
}
